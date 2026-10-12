/**
 * Comissões (módulo 7). Motor idempotente de recálculo: para cada regra ativa, encontra as notas no escopo
 * (contrato/entidade da regra ou todas as entidades/contratos vinculados ao parceiro) e mantém UMA comissão por
 * (regra, nota) — unicidade no banco impede duplicidade. Situações:
 *   FORECAST  nota emitida e ainda não paga (previsão)            DUE   nota PAGA (recebimento confirmado) → a pagar ao parceiro
 *   PAID      comissão paga ao parceiro (ação manual, auditada)   REVERSED  nota cancelada/voltou a pendente depois de DUE/PAID
 * Base: RECEIVED usa paidAmount (pagamentos parciais) quando a nota está paga; INVOICED usa o valor da nota.
 * O recálculo roda após alterações de notas (manual, lote, conflitos, sincronização) e no cron diário.
 */
import { Prisma } from '@siow/db';
import { dateToIso, isoToDate, type CommissionRow, type CommissionRuleRow, type Paginated } from '@siow/shared';
import type { z } from 'zod';
import type { commissionListFilterSchema, commissionRuleSchema, payCommissionsSchema, updateCommissionRuleSchema } from '@siow/shared';
import { prisma } from '../db.js';
import { currentOrgId } from '../tenant.js';
import { audit } from '../audit.js';
import { badRequest, notFound, type Ctx } from '../http.js';

// ---------------- regras ----------------
type RuleRec = Prisma.CommissionRuleGetPayload<Record<string, never>>;
/** A regra guarda só os ids de entidade/contrato (sem relação no Prisma): nomes resolvidos aqui. */
async function toRules(rows: RuleRec[]): Promise<CommissionRuleRow[]> {
  const eids = [...new Set(rows.map((r) => r.entityId).filter(Boolean) as string[])];
  const cids = [...new Set(rows.map((r) => r.contractId).filter(Boolean) as string[])];
  const [ents, ctrs] = await Promise.all([
    eids.length ? prisma.entity.findMany({ where: { id: { in: eids } }, select: { id: true, name: true, shortName: true } }) : [],
    cids.length ? prisma.contract.findMany({ where: { id: { in: cids } }, select: { id: true, number: true } }) : [],
  ]);
  const en = new Map(ents.map((e) => [e.id, e.shortName ?? e.name])); const cn = new Map(ctrs.map((c) => [c.id, c.number]));
  return rows.map((r) => ({ id: r.id, partnerId: r.partnerId, name: r.name, basis: r.basis, percent: r.percent.toFixed(2), entityId: r.entityId, entityName: r.entityId ? en.get(r.entityId) ?? null : null, contractId: r.contractId, contractNumber: r.contractId ? cn.get(r.contractId) ?? null : null, startDate: dateToIso(r.startDate), endDate: dateToIso(r.endDate), maxMonths: r.maxMonths, isActive: r.isActive, notes: r.notes }));
}
const toRule = async (r: RuleRec): Promise<CommissionRuleRow> => (await toRules([r]))[0]!;

export async function listRules(partnerId: string): Promise<CommissionRuleRow[]> {
  const rows = await prisma.commissionRule.findMany({ where: { partnerId }, orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }] });
  return toRules(rows);
}

export async function createRule(ctx: Ctx, partnerId: string, input: z.infer<typeof commissionRuleSchema>): Promise<CommissionRuleRow> {
  const partner = await prisma.partner.findFirst({ where: { id: partnerId, deletedAt: null } });
  if (!partner) throw notFound('Parceiro não encontrado');
  if (input.contractId) { const c = await prisma.contract.findFirst({ where: { id: input.contractId, deletedAt: null }, select: { entityId: true } }); if (!c) throw badRequest('Contrato não encontrado'); if (input.entityId && c.entityId !== input.entityId) throw badRequest('O contrato não pertence à entidade informada'); }
  const r = await prisma.commissionRule.create({ data: { organizationId: currentOrgId(), partnerId, ...input, percent: new Prisma.Decimal(input.percent), startDate: input.startDate ? isoToDate(input.startDate) : null, endDate: input.endDate ? isoToDate(input.endDate) : null } });
  await audit(ctx, { action: 'CREATE', resource: 'commissionRule', resourceId: r.id, after: { partnerId, name: r.name, basis: r.basis, percent: r.percent } });
  await recompute({ partnerId });
  return toRule(r);
}

export async function updateRule(ctx: Ctx, id: string, input: z.infer<typeof updateCommissionRuleSchema>): Promise<CommissionRuleRow> {
  const before = await prisma.commissionRule.findFirst({ where: { id } });
  if (!before) throw notFound('Regra não encontrada');
  const r = await prisma.commissionRule.update({ where: { id }, data: { ...input, percent: input.percent !== undefined ? new Prisma.Decimal(input.percent) : undefined, startDate: input.startDate === undefined ? undefined : input.startDate ? isoToDate(input.startDate) : null, endDate: input.endDate === undefined ? undefined : input.endDate ? isoToDate(input.endDate) : null } });
  await audit(ctx, { action: 'UPDATE', resource: 'commissionRule', resourceId: id, before, after: r });
  await recompute({ partnerId: r.partnerId });
  return toRule(r);
}

export async function removeRule(ctx: Ctx, id: string): Promise<void> {
  const before = await prisma.commissionRule.findFirst({ where: { id }, include: { _count: { select: { commissions: { where: { status: { in: ['DUE', 'PAID'] } } } } } } });
  if (!before) throw notFound('Regra não encontrada');
  if (before._count.commissions) {
    await prisma.commissionRule.update({ where: { id }, data: { isActive: false } });
    await audit(ctx, { action: 'UPDATE', resource: 'commissionRule', resourceId: id, before: { isActive: before.isActive }, after: { isActive: false }, justification: 'Regra com comissões a pagar/pagas: desativada em vez de excluída' });
  } else {
    await prisma.commissionRule.delete({ where: { id } });
    await audit(ctx, { action: 'DELETE', resource: 'commissionRule', resourceId: id, before });
  }
  await recompute({ partnerId: before.partnerId });
}

// ---------------- motor ----------------
const money = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/**
 * Recalcula comissões do escopo (parceiro, entidade ou nota). Idempotente:
 *  - cria/atualiza FORECAST e DUE conforme a situação da nota;
 *  - comissão PAID nunca muda de valor; se a nota deixar de estar paga, vira REVERSED (estorno registrado);
 *  - nota fora do escopo/cancelada: FORECAST é removida, DUE vira REVERSED (sem valor a pagar).
 */
export async function recompute(scope: { partnerId?: string; entityId?: string; invoiceIds?: string[] } = {}): Promise<{ rules: number; created: number; updated: number; reversed: number; removed: number }> {
  const org = currentOrgId();
  const stats = { rules: 0, created: 0, updated: 0, reversed: 0, removed: 0 };
  const rules = await prisma.commissionRule.findMany({ where: { partnerId: scope.partnerId, partner: { deletedAt: null } }, include: { partner: { select: { id: true, isActive: true } } } });
  for (const rule of rules) {
    stats.rules += 1;
    // escopo de notas da regra
    const where: Prisma.InvoiceWhereInput = { deletedAt: null, status: { in: ['PENDING', 'PAID'] } };
    if (rule.contractId) where.contractId = rule.contractId;
    else if (rule.entityId) where.entityId = rule.entityId;
    else where.OR = [{ entity: { partnerId: rule.partnerId } }, { contract: { partnerId: rule.partnerId } }];
    if (scope.entityId) where.entityId = scope.entityId;
    if (scope.invoiceIds) where.id = { in: scope.invoiceIds };
    const active = rule.isActive && rule.partner.isActive;
    const invoices = active ? await prisma.invoice.findMany({ where, select: { id: true, entityId: true, contractId: true, status: true, amount: true, paidAmount: true, paidAt: true, issueDate: true, competenceYear: true, competenceMonth: true, contract: { select: { startDate: true } } } }) : [];
    const existing = await prisma.commission.findMany({ where: { ruleId: rule.id, ...(scope.entityId ? { entityId: scope.entityId } : {}), ...(scope.invoiceIds ? { invoiceId: { in: scope.invoiceIds } } : {}) } });
    const byInvoice = new Map(existing.map((c) => [c.invoiceId, c]));
    const seen = new Set<string>();
    for (const inv of invoices) {
      // janela da regra: por data de emissão/competência e limite de meses desde o início do contrato
      const comp = `${inv.competenceYear}-${String(inv.competenceMonth).padStart(2, '0')}`;
      if (rule.startDate && comp < dateToIso(rule.startDate)!.slice(0, 7)) continue;
      if (rule.endDate && comp > dateToIso(rule.endDate)!.slice(0, 7)) continue;
      if (rule.maxMonths && inv.contract?.startDate) {
        const s = inv.contract.startDate; const months = (inv.competenceYear - s.getUTCFullYear()) * 12 + (inv.competenceMonth - (s.getUTCMonth() + 1));
        if (months >= rule.maxMonths) continue;
      }
      seen.add(inv.id);
      const paid = inv.status === 'PAID';
      const base = rule.basis === 'RECEIVED' ? (paid ? inv.paidAmount ?? inv.amount : inv.amount) : inv.amount;
      const amount = money(base.mul(rule.percent).div(100));
      const status = rule.basis === 'RECEIVED' ? (paid ? 'DUE' : 'FORECAST') : 'DUE';
      const dueAt = status === 'DUE' ? (paid ? inv.paidAt : inv.issueDate) : null;
      const cur = byInvoice.get(inv.id);
      if (!cur) {
        await prisma.commission.create({ data: { organizationId: org, partnerId: rule.partnerId, ruleId: rule.id, invoiceId: inv.id, entityId: inv.entityId, contractId: inv.contractId, competenceYear: inv.competenceYear, competenceMonth: inv.competenceMonth, baseAmount: base, percent: rule.percent, amount, status, dueAt } });
        stats.created += 1;
      } else if (cur.status === 'PAID') {
        continue; // paga ao parceiro: imutável (estorno só se a nota deixar de estar paga — tratado abaixo)
      } else if (cur.status === 'REVERSED' && status === 'DUE') {
        // estorno desfeito: se já tinha sido paga ao parceiro, volta a PAID (não gera novo pagamento); senão volta a DUE
        const wasPaid = Boolean(cur.paidAt);
        await prisma.commission.update({ where: { id: cur.id }, data: { status: wasPaid ? 'PAID' : 'DUE', baseAmount: base, amount, dueAt, notes: wasPaid ? 'Estorno desfeito: nota voltou a estar paga; comissão já havia sido paga ao parceiro' : 'Reativada: nota voltou a estar paga' } }); stats.updated += 1;
      } else if (cur.status !== status || !cur.amount.equals(amount) || !cur.baseAmount.equals(base)) {
        if (cur.status !== 'REVERSED') { await prisma.commission.update({ where: { id: cur.id }, data: { status, baseAmount: base, amount, dueAt } }); stats.updated += 1; }
      }
    }
    // comissões cujas notas saíram do escopo (cancelada, excluída, regra desativada, nota pendente de novo…)
    for (const c of existing) {
      if (seen.has(c.invoiceId)) continue;
      if (c.status === 'FORECAST') { await prisma.commission.delete({ where: { id: c.id } }); stats.removed += 1; }
      else if (c.status === 'DUE' || c.status === 'PAID') { await prisma.commission.update({ where: { id: c.id }, data: { status: 'REVERSED', notes: c.status === 'PAID' ? 'ESTORNO: comissão já paga ao parceiro, nota deixou de estar paga/cancelada — compensar no próximo acerto' : 'Nota deixou de estar paga ou foi cancelada' } }); stats.reversed += 1; }
    }
    // nota PAID → PENDING dentro do escopo com regra RECEIVED: tratada acima (status FORECAST), mas se estava PAID (comissão paga) vira REVERSED
    for (const inv of invoices) {
      const cur = byInvoice.get(inv.id);
      if (cur && cur.status === 'PAID' && rule.basis === 'RECEIVED' && inv.status !== 'PAID') { await prisma.commission.update({ where: { id: cur.id }, data: { status: 'REVERSED', notes: 'ESTORNO: comissão já paga ao parceiro e a nota voltou a pendente — compensar no próximo acerto' } }); stats.reversed += 1; }
    }
  }
  return stats;
}

/** Recálculo "best effort" depois de alterações em notas (nunca falha a operação principal). */
export async function recomputeAfterInvoiceChange(invoiceIds: string[]): Promise<void> {
  try { await recompute({ invoiceIds }); } catch (e) { console.error('commissions recompute failed', e); }
}

// ---------------- consulta e pagamento ----------------
const include = { partner: { select: { name: true } }, rule: { select: { name: true } }, invoice: { select: { number: true, status: true } }, entity: { select: { id: true, name: true, shortName: true } }, contract: { select: { number: true } } } satisfies Prisma.CommissionInclude;
const toRow = (c: Prisma.CommissionGetPayload<{ include: typeof include }>): CommissionRow => ({
  id: c.id, partnerId: c.partnerId, partnerName: c.partner.name, ruleId: c.ruleId, ruleName: c.rule.name, invoiceId: c.invoiceId, invoiceNumber: c.invoice.number, invoiceStatus: c.invoice.status,
  entity: c.entity, contractNumber: c.contract?.number ?? null, competence: `${String(c.competenceMonth).padStart(2, '0')}/${c.competenceYear}`,
  baseAmount: c.baseAmount.toFixed(2), percent: c.percent.toFixed(2), amount: c.amount.toFixed(2), status: c.status, dueAt: dateToIso(c.dueAt), paidAt: dateToIso(c.paidAt), paymentRef: c.paymentRef, notes: c.notes,
});

export async function list(f: z.infer<typeof commissionListFilterSchema>): Promise<Paginated<CommissionRow> & { totals: Record<string, string> }> {
  const where: Prisma.CommissionWhereInput = { partnerId: f.partnerId, status: f.status, entityId: f.entityId, competenceYear: f.year, competenceMonth: f.month };
  const [rows, total, sums] = await Promise.all([
    prisma.commission.findMany({ where, include, orderBy: [{ competenceYear: 'desc' }, { competenceMonth: 'desc' }, { createdAt: 'desc' }], skip: (f.page - 1) * f.pageSize, take: f.pageSize }),
    prisma.commission.count({ where }),
    prisma.commission.groupBy({ by: ['status'], where, _sum: { amount: true } }),
  ]);
  const totals: Record<string, string> = { FORECAST: '0.00', DUE: '0.00', PAID: '0.00', REVERSED: '0.00' };
  for (const s of sums) totals[s.status] = (s._sum.amount ?? new Prisma.Decimal(0)).toFixed(2);
  return { items: rows.map(toRow), total, page: f.page, pageSize: f.pageSize, totals };
}

/** Registra o pagamento ao parceiro das comissões DUE selecionadas (ação manual e auditada; nada é pago automaticamente). */
export async function pay(ctx: Ctx, input: z.infer<typeof payCommissionsSchema>): Promise<{ paid: number; amount: string }> {
  const rows = await prisma.commission.findMany({ where: { id: { in: input.ids }, status: 'DUE' } });
  if (!rows.length) throw badRequest('Nenhuma comissão "a pagar" entre as selecionadas');
  const amount = rows.reduce((a, c) => a.add(c.amount), new Prisma.Decimal(0));
  await prisma.commission.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: 'PAID', paidAt: isoToDate(input.paidAt), paidByUserId: ctx.user.id, paymentRef: input.paymentRef ?? null, notes: input.notes ?? undefined } });
  await audit(ctx, { action: 'COMMISSIONS_PAID', resource: 'commission', resourceId: rows[0]!.partnerId, after: { ids: rows.map((r) => r.id), amount: amount.toFixed(2), paidAt: input.paidAt, paymentRef: input.paymentRef ?? null } });
  return { paid: rows.length, amount: amount.toFixed(2) };
}

/** Resumo para dashboard/relatórios: totais por parceiro e situação. */
export async function summary(): Promise<Array<{ partnerId: string; partnerName: string; forecast: string; due: string; paid: string; reversed: string }>> {
  const partners = await prisma.partner.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  const groups = await prisma.commission.groupBy({ by: ['partnerId', 'status'], _sum: { amount: true } });
  return partners.map((p) => { const g = (s: string) => (groups.find((x) => x.partnerId === p.id && x.status === s)?._sum.amount ?? new Prisma.Decimal(0)).toFixed(2); return { partnerId: p.id, partnerName: p.name, forecast: g('FORECAST'), due: g('DUE'), paid: g('PAID'), reversed: g('REVERSED') }; });
}
