/**
 * Parceiros (módulo 7): cadastro, vínculo com entidades (entities.partnerId) e valor mensal de cada vínculo
 * (entities.partnerMonthlyValue), pagamentos feitos pelo parceiro (partner_payments), extrato consolidado.
 * O portal do parceiro (papel PARCEIRO) só enxerga o parceiro ligado ao próprio usuário (`Partner.userId`).
 */
import { Prisma } from '@siow/db';
import { todayIso, type PartnerPaymentRow, type PartnerPaymentsSummary, type PartnerRow, type PartnerStatement } from '@siow/shared';
import type { z } from 'zod';
import type { linkPartnerEntitiesSchema, partnerEntityValueSchema, partnerPaymentSchema, partnerSchema, updatePartnerSchema } from '@siow/shared';
import { prisma } from '../db.js';
import { currentOrgId } from '../tenant.js';
import { audit } from '../audit.js';
import { badRequest, forbidden, notFound, type Ctx } from '../http.js';
import { bulkStatus } from './invoices.js';

const include = { user: { select: { name: true } }, _count: { select: { entities: true, contracts: true, opportunities: true, rules: { where: { isActive: true } } } } } satisfies Prisma.PartnerInclude;
type Row = Prisma.PartnerGetPayload<{ include: typeof include }>;

async function totalsFor(ids: string[]): Promise<Map<string, PartnerRow['totals']>> {
  const out = new Map<string, PartnerRow['totals']>();
  if (!ids.length) return out;
  const groups = await prisma.commission.groupBy({ by: ['partnerId', 'status'], where: { partnerId: { in: ids } }, _sum: { amount: true } });
  for (const id of ids) out.set(id, { forecast: '0.00', due: '0.00', paid: '0.00', reversed: '0.00' });
  for (const g of groups) {
    const t = out.get(g.partnerId)!;
    const v = (g._sum.amount ?? new Prisma.Decimal(0)).toFixed(2);
    if (g.status === 'FORECAST') t.forecast = v; else if (g.status === 'DUE') t.due = v; else if (g.status === 'PAID') t.paid = v; else if (g.status === 'REVERSED') t.reversed = v;
  }
  return out;
}

/** Soma do valor mensal das entidades vinculadas, por parceiro. */
async function monthlyFor(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const groups = await prisma.entity.groupBy({ by: ['partnerId'], where: { partnerId: { in: ids }, deletedAt: null }, _sum: { partnerMonthlyValue: true } });
  return new Map(groups.map((g) => [g.partnerId!, (g._sum.partnerMonthlyValue ?? new Prisma.Decimal(0)).toFixed(2)]));
}

/** Total pago por parceiro: na competência atual e no total. */
async function paidFor(ids: string[]): Promise<Map<string, { month: string; total: string }>> {
  const out = new Map<string, { month: string; total: string }>();
  if (!ids.length) return out;
  const [y, m] = todayIso().split('-').map(Number) as [number, number];
  const [all, month] = await Promise.all([
    prisma.partnerPayment.groupBy({ by: ['partnerId'], where: { partnerId: { in: ids } }, _sum: { amount: true } }),
    prisma.partnerPayment.groupBy({ by: ['partnerId'], where: { partnerId: { in: ids }, competenceYear: y, competenceMonth: m }, _sum: { amount: true } }),
  ]);
  for (const g of all) out.set(g.partnerId, { month: '0.00', total: (g._sum.amount ?? new Prisma.Decimal(0)).toFixed(2) });
  for (const g of month) out.get(g.partnerId)!.month = (g._sum.amount ?? new Prisma.Decimal(0)).toFixed(2);
  return out;
}

async function toRows(rows: Row[]): Promise<PartnerRow[]> {
  const ids = rows.map((r) => r.id);
  const [totals, monthly, paid] = await Promise.all([totalsFor(ids), monthlyFor(ids), paidFor(ids)]);
  return rows.map((r) => ({
    id: r.id, name: r.name, kind: r.kind, document: r.document, contactName: r.contactName, email: r.email, phone: r.phone, whatsapp: r.whatsapp,
    userId: r.userId, userName: r.user?.name ?? null, bankInfo: r.bankInfo, notes: r.notes, isActive: r.isActive,
    entityCount: r._count.entities, contractCount: r._count.contracts, opportunityCount: r._count.opportunities, ruleCount: r._count.rules,
    monthlyTotal: monthly.get(r.id) ?? '0.00', paidThisMonth: paid.get(r.id)?.month ?? '0.00', paidTotal: paid.get(r.id)?.total ?? '0.00',
    totals: totals.get(r.id) ?? { forecast: '0.00', due: '0.00', paid: '0.00', reversed: '0.00' },
  }));
}

export async function list(q?: string): Promise<PartnerRow[]> {
  const rows = await prisma.partner.findMany({ where: { deletedAt: null, name: q ? { contains: q, mode: 'insensitive' } : undefined }, include, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
  return toRows(rows);
}

export async function get(id: string): Promise<PartnerRow> {
  const p = await prisma.partner.findFirst({ where: { id, deletedAt: null }, include });
  if (!p) throw notFound('Parceiro não encontrado');
  return (await toRows([p]))[0]!;
}

/** Parceiro ligado ao usuário atual (portal). */
export async function mine(ctx: Ctx): Promise<PartnerRow> {
  const p = await prisma.partner.findFirst({ where: { userId: ctx.user.id, deletedAt: null }, include });
  if (!p) throw forbidden('Seu usuário não está vinculado a um parceiro');
  return (await toRows([p]))[0]!;
}

export async function create(ctx: Ctx, input: z.infer<typeof partnerSchema>): Promise<PartnerRow> {
  if (input.userId) { const u = await prisma.user.findFirst({ where: { id: input.userId, deletedAt: null } }); if (!u) throw badRequest('Usuário não encontrado'); }
  const p = await prisma.partner.create({ data: { organizationId: currentOrgId(), ...input, email: input.email || null }, include });
  await audit(ctx, { action: 'CREATE', resource: 'partner', resourceId: p.id, after: { name: p.name, kind: p.kind } });
  return (await toRows([p]))[0]!;
}

export async function update(ctx: Ctx, id: string, input: z.infer<typeof updatePartnerSchema>): Promise<PartnerRow> {
  const before = await prisma.partner.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw notFound('Parceiro não encontrado');
  const p = await prisma.partner.update({ where: { id }, data: { ...input, email: input.email === undefined ? undefined : input.email || null }, include });
  await audit(ctx, { action: 'UPDATE', resource: 'partner', resourceId: id, before, after: p });
  return (await toRows([p]))[0]!;
}

/** Exclusão lógica; comissões ficam registradas. Parceiro com comissões a pagar não pode ser excluído. */
export async function remove(ctx: Ctx, id: string): Promise<void> {
  const before = await prisma.partner.findFirst({ where: { id, deletedAt: null }, include: { _count: { select: { commissions: { where: { status: 'DUE' } } } } } });
  if (!before) throw notFound('Parceiro não encontrado');
  if (before._count.commissions) throw badRequest('Parceiro com comissões a pagar: quite ou estorne antes de excluir');
  await prisma.$transaction([
    prisma.entity.updateMany({ where: { partnerId: id }, data: { partnerId: null, partnerMonthlyValue: null, partnerNotes: null } }),
    prisma.commissionRule.updateMany({ where: { partnerId: id }, data: { isActive: false } }),
    prisma.partner.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } }),
  ]);
  await audit(ctx, { action: 'SOFT_DELETE', resource: 'partner', resourceId: id, before: { name: before.name } });
}

/** Vincula/desvincula entidades ao parceiro (uma entidade tem no máximo um parceiro). */
export async function linkEntities(ctx: Ctx, id: string, input: z.infer<typeof linkPartnerEntitiesSchema>): Promise<{ updated: number }> {
  await get(id);
  const r = input.unlink
    ? await prisma.entity.updateMany({ where: { id: { in: input.entityIds }, partnerId: id }, data: { partnerId: null, partnerMonthlyValue: null, partnerNotes: null } })
    : await prisma.entity.updateMany({ where: { id: { in: input.entityIds }, deletedAt: null }, data: { partnerId: id } });
  await audit(ctx, { action: input.unlink ? 'PARTNER_UNLINK' : 'PARTNER_LINK', resource: 'partner', resourceId: id, after: { entityIds: input.entityIds, updated: r.count } });
  return { updated: r.count };
}

/** Valor mensal e observação do vínculo parceiro × entidade. */
export async function setEntityValue(ctx: Ctx, id: string, entityId: string, input: z.infer<typeof partnerEntityValueSchema>): Promise<{ ok: true }> {
  const before = await prisma.entity.findFirst({ where: { id: entityId, partnerId: id, deletedAt: null }, select: { partnerMonthlyValue: true, partnerNotes: true } });
  if (!before) throw notFound('Entidade não vinculada a este parceiro');
  const data = { partnerMonthlyValue: input.monthlyValue === null ? null : new Prisma.Decimal(input.monthlyValue), partnerNotes: input.notes === undefined ? undefined : input.notes || null };
  await prisma.entity.update({ where: { id: entityId }, data });
  await audit(ctx, { action: 'UPDATE', resource: 'partner', resourceId: id, before: { entityId, ...before }, after: { entityId, ...data } });
  return { ok: true };
}

const competenceKey = (y: number, m: number): string => `${y}-${String(m).padStart(2, '0')}`;

/** Pagamentos do parceiro e o resumo por competência (esperado = soma atual dos valores mensais das entidades vinculadas). */
export async function payments(id: string): Promise<PartnerPaymentsSummary> {
  const partner = await get(id);
  const rows = await prisma.partnerPayment.findMany({ where: { partnerId: id }, include: { entity: { select: { name: true, shortName: true } } }, orderBy: [{ competenceYear: 'desc' }, { competenceMonth: 'desc' }, { paidAt: 'desc' }] });
  const list: PartnerPaymentRow[] = rows.map((r) => ({
    id: r.id, entityId: r.entityId, entityName: r.entity ? r.entity.shortName ?? r.entity.name : null, competence: competenceKey(r.competenceYear, r.competenceMonth),
    amount: r.amount.toFixed(2), paidAt: r.paidAt.toISOString().slice(0, 10), notes: r.notes, createdAt: r.createdAt.toISOString(),
  }));
  const paid = new Map<string, Prisma.Decimal>([[todayIso().slice(0, 7), new Prisma.Decimal(0)]]);
  for (const r of rows) { const k = competenceKey(r.competenceYear, r.competenceMonth); paid.set(k, (paid.get(k) ?? new Prisma.Decimal(0)).add(r.amount)); }
  const expected = new Prisma.Decimal(partner.monthlyTotal);
  const byMonth = [...paid.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([competence, v]) => ({ competence, expected: expected.toFixed(2), paid: v.toFixed(2), balance: expected.sub(v).toFixed(2) }));
  return { payments: list, byMonth };
}

/**
 * Registra o pagamento do parceiro (geral, sem entidade) e dá baixa nas notas pendentes da mesma competência das
 * entidades vinculadas a ele: cada nota é baixada inteira, na ordem da entidade, enquanto o valor pago cobrir.
 * A baixa segue o caminho de `bulkStatus` (override manual, eventos, auditoria, recálculo de comissões) e só
 * acontece se o usuário também puder alterar notas (`invoices.override`).
 */
export async function addPayment(ctx: Ctx, id: string, input: z.infer<typeof partnerPaymentSchema>): Promise<{ id: string; settled: number; settledAmount: string; pending: number }> {
  const partner = await get(id);
  if (input.entityId) { const e = await prisma.entity.findFirst({ where: { id: input.entityId, partnerId: id, deletedAt: null } }); if (!e) throw badRequest('Entidade não vinculada a este parceiro'); }
  const [y, m] = input.competence.split('-').map(Number) as [number, number];
  const amount = new Prisma.Decimal(input.amount);
  const p = await prisma.partnerPayment.create({ data: { organizationId: currentOrgId(), partnerId: id, entityId: input.entityId ?? null, competenceYear: y, competenceMonth: m, amount, paidAt: new Date(`${input.paidAt}T00:00:00Z`), notes: input.notes || null, createdByUserId: ctx.user.id.startsWith('apikey:') ? null : ctx.user.id } });
  const pendingInvoices = await prisma.invoice.findMany({
    where: { deletedAt: null, status: 'PENDING', competenceYear: y, competenceMonth: m, entity: { partnerId: id, deletedAt: null }, ...(input.entityId ? { entityId: input.entityId } : {}) },
    select: { id: true, amount: true, entity: { select: { name: true } } },
  });
  pendingInvoices.sort((a, b) => a.entity.name.localeCompare(b.entity.name, 'pt-BR'));
  const toSettle: string[] = [];
  let left = amount;
  for (const inv of pendingInvoices) if (left.gte(inv.amount)) { toSettle.push(inv.id); left = left.sub(inv.amount); }
  let settled = 0;
  let settledAmount = new Prisma.Decimal(0);
  if (toSettle.length && ctx.user.permissions.includes('invoices.override')) {
    const r = await bulkStatus(ctx, { ids: toSettle, status: 'PAID', paidAt: input.paidAt, justification: `Baixa pelo pagamento do parceiro ${partner.name} (competência ${String(m).padStart(2, '0')}/${y})` });
    settled = r.updated;
    const failed = new Set(r.errors.map((e) => e.id));
    for (const inv of pendingInvoices) if (toSettle.includes(inv.id) && !failed.has(inv.id)) settledAmount = settledAmount.add(inv.amount);
  }
  await audit(ctx, { action: 'CREATE', resource: 'partner_payment', resourceId: p.id, after: { partnerId: id, entityId: p.entityId, competence: input.competence, amount: input.amount, paidAt: input.paidAt, settledInvoiceIds: settled ? toSettle : [] } });
  return { id: p.id, settled, settledAmount: settledAmount.toFixed(2), pending: pendingInvoices.length - settled };
}

export async function removePayment(ctx: Ctx, id: string, paymentId: string): Promise<{ ok: true }> {
  const before = await prisma.partnerPayment.findFirst({ where: { id: paymentId, partnerId: id } });
  if (!before) throw notFound('Pagamento não encontrado');
  await prisma.partnerPayment.delete({ where: { id: paymentId } });
  await audit(ctx, { action: 'DELETE', resource: 'partner_payment', resourceId: paymentId, before });
  return { ok: true };
}

/** Extrato do parceiro: totais por situação, por competência, entidades e oportunidades vinculadas. */
export async function statement(id: string): Promise<PartnerStatement> {
  const partner = await get(id);
  const [commissions, entities, opportunities] = await Promise.all([
    prisma.commission.findMany({ where: { partnerId: id }, select: { status: true, amount: true, competenceYear: true, competenceMonth: true } }),
    prisma.entity.findMany({ where: { partnerId: id, deletedAt: null }, select: { id: true, name: true, shortName: true, municipality: true, uf: true, partnerMonthlyValue: true, partnerNotes: true, contracts: { where: { deletedAt: null, status: 'ACTIVE' }, select: { number: true }, take: 1 } }, orderBy: { name: 'asc' } }),
    prisma.opportunity.findMany({ where: { OR: [{ partnerId: id }, { entity: { partnerId: id } }], deletedAt: null }, select: { id: true, title: true, status: true, totalAmount: true, stage: { select: { name: true } }, entity: { select: { name: true, shortName: true } } }, orderBy: { updatedAt: 'desc' }, take: 50 }),
  ]);
  const months = new Map<string, { forecast: Prisma.Decimal; due: Prisma.Decimal; paid: Prisma.Decimal }>();
  let dueCount = 0;
  for (const c of commissions) {
    const k = `${c.competenceYear}-${String(c.competenceMonth).padStart(2, '0')}`;
    const m = months.get(k) ?? { forecast: new Prisma.Decimal(0), due: new Prisma.Decimal(0), paid: new Prisma.Decimal(0) };
    if (c.status === 'FORECAST') m.forecast = m.forecast.add(c.amount); else if (c.status === 'DUE') { m.due = m.due.add(c.amount); dueCount += 1; } else if (c.status === 'PAID') m.paid = m.paid.add(c.amount);
    months.set(k, m);
  }
  return {
    partner,
    totals: { ...partner.totals, dueCount },
    byMonth: [...months.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([competence, m]) => ({ competence, forecast: m.forecast.toFixed(2), due: m.due.toFixed(2), paid: m.paid.toFixed(2) })),
    entities: entities.map((e) => ({ id: e.id, name: e.name, shortName: e.shortName, municipality: e.municipality, uf: e.uf, activeContract: e.contracts[0]?.number ?? null, monthlyValue: e.partnerMonthlyValue ? e.partnerMonthlyValue.toFixed(2) : null, partnerNotes: e.partnerNotes })),
    opportunities: opportunities.map((o) => ({ id: o.id, title: o.title, status: o.status, stageName: o.stage.name, totalAmount: o.totalAmount ? o.totalAmount.toFixed(2) : null, entityName: o.entity.shortName ?? o.entity.name })),
  };
}
