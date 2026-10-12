/**
 * Contratos, aditivos (ContractAmendment), documentos e conta corrente (ledger).
 */
import { Prisma } from '@siow/db';
import { competencesBetween, dateToIso, isoToDate, todayIso, toDecimalString, type ContractLedger, type ContractLedgerMonth } from '@siow/shared';
import type { z } from 'zod';
import type { activateContractSchema, adjustContractSchema, createAmendmentSchema, createContractSchema, terminateContractSchema, updateContractSchema } from '@siow/shared';
import { daysBetween, type ContractFinancialStatus } from '@siow/shared';
import { currentOrgId as orgId } from '../tenant.js';
import { create as createAlarm } from './alarms.js';
import { prisma } from '../db.js';
import { currentOrgId } from '../tenant.js';
import { audit } from '../audit.js';
import { badRequest, notFound, type Ctx } from '../http.js';
import { get as getDocument, storeDocument } from './documents.js';

const date = (iso: string | null | undefined): Date | null | undefined => (iso === undefined ? undefined : iso ? isoToDate(iso) : null);
const dec = (v: string | null | undefined): Prisma.Decimal | null | undefined => (v === undefined ? undefined : v ? new Prisma.Decimal(v) : null);

export interface ContractListFilter { entityId?: string; status?: string; expiringDays?: number; q?: string }

export async function list(filter: ContractListFilter) {
  const where: Prisma.ContractWhereInput = { deletedAt: null, entityId: filter.entityId };
  if (filter.status) where.status = filter.status as Prisma.ContractWhereInput['status'];
  if (filter.q) where.OR = [{ number: { contains: filter.q, mode: 'insensitive' } }, { object: { contains: filter.q, mode: 'insensitive' } }, { entity: { name: { contains: filter.q, mode: 'insensitive' } } }];
  if (filter.expiringDays !== undefined) {
    where.status = 'ACTIVE';
    where.endDate = { lte: new Date(Date.now() + filter.expiringDays * 86_400_000), gte: new Date() };
  }
  return prisma.contract.findMany({
    where,
    include: {
      entity: { select: { id: true, name: true, shortName: true, type: true, municipality: true, uf: true } },
      amendments: { orderBy: { sequence: 'asc' } },
      responsibleUser: { select: { id: true, name: true } },
      _count: { select: { invoices: true, serviceOrders: true } },
    },
    orderBy: [{ endDate: 'asc' }],
  });
}

export async function get(id: string) {
  const c = await prisma.contract.findFirst({
    where: { id, deletedAt: null },
    include: {
      entity: true,
      amendments: { orderBy: { sequence: 'asc' }, include: { document: { select: { id: true, name: true } } } },
      documents: { where: { deletedAt: null }, orderBy: { capturedAt: 'desc' } },
      responsibleUser: { select: { id: true, name: true } },
    },
  });
  if (!c) throw notFound('Contrato não encontrado');
  return c;
}

export async function create(ctx: Ctx, input: z.infer<typeof createContractSchema>) {
  const c = await prisma.contract.create({
    data: {
      organizationId: currentOrgId(),
      entityId: input.entityId,
      number: input.number,
      object: input.object,
      description: input.description,
      monthlyValue: dec(input.monthlyValue),
      totalValue: dec(input.totalValue),
      startDate: date(input.startDate),
      endDate: date(input.endDate),
      status: input.status ?? 'ACTIVE',
      expectsMonthlyBilling: input.expectsMonthlyBilling ?? true,
      responsibleUserId: input.responsibleUserId,
      notes: input.notes,
      origin: 'MANUAL',
    },
  });
  await audit(ctx, { action: 'CREATE', resource: 'contract', resourceId: c.id, after: c });
  return c;
}

export async function update(ctx: Ctx, id: string, input: z.infer<typeof updateContractSchema>) {
  const before = await get(id);
  const c = await prisma.contract.update({
    where: { id },
    data: {
      number: input.number,
      object: input.object,
      description: input.description,
      monthlyValue: dec(input.monthlyValue),
      totalValue: dec(input.totalValue),
      startDate: date(input.startDate),
      endDate: date(input.endDate),
      status: input.status,
      expectsMonthlyBilling: input.expectsMonthlyBilling,
      responsibleUserId: input.responsibleUserId,
      notes: input.notes,
      // Uma edição manual passa a proteger a vigência contra sobrescrita pela sincronização
      origin: input.startDate !== undefined || input.endDate !== undefined ? 'MANUAL' : undefined,
    },
  });
  await audit(ctx, { action: 'UPDATE', resource: 'contract', resourceId: id, before: { ...before, entity: undefined, amendments: undefined, documents: undefined }, after: c });
  return c;
}

/** Exclusão lógica do contrato; os aditivos são removidos (ficam registrados na auditoria). */
export async function softDelete(ctx: Ctx, id: string): Promise<void> {
  const before = await get(id);
  await prisma.$transaction([
    prisma.contractAmendment.deleteMany({ where: { contractId: id } }),
    prisma.contract.update({ where: { id }, data: { deletedAt: new Date(), status: 'TERMINATED' } }),
  ]);
  await audit(ctx, {
    action: 'SOFT_DELETE', resource: 'contract', resourceId: id,
    before: { number: before.number, entityId: before.entityId, endDate: before.endDate, monthlyValue: before.monthlyValue, amendments: before.amendments.map((a) => ({ ...a, document: undefined })) },
  });
}

// ---------------- aditivos ----------------
export async function addAmendment(ctx: Ctx, contractId: string, input: z.infer<typeof createAmendmentSchema>) {
  const contract = await get(contractId);
  const sequence = input.sequence ?? (contract.amendments.at(-1)?.sequence ?? 0) + 1;
  if (input.documentId) await getDocument(input.documentId);
  // Reajuste: sem valor informado, calcula a partir do valor mensal vigente × (1 + percentual)
  let newMonthlyValue = dec(input.newMonthlyValue) ?? null;
  if (input.kind === 'ADJUSTMENT') {
    if (input.adjustmentPercent === null || input.adjustmentPercent === undefined) throw badRequest('Informe o percentual do reajuste');
    if (!newMonthlyValue) {
      if (!contract.monthlyValue) throw badRequest('Contrato sem valor mensal: informe o novo valor');
      newMonthlyValue = contract.monthlyValue.mul(new Prisma.Decimal(1).add(new Prisma.Decimal(input.adjustmentPercent).div(100))).toDecimalPlaces(2);
    }
  }
  const a = await prisma.$transaction(async (tx) => {
    const created = await tx.contractAmendment.create({
      data: {
        contractId,
        sequence,
        label: input.label ?? (input.kind === 'ADJUSTMENT' ? `Reajuste ${input.adjustmentIndex ?? ''}`.trim() : `${sequence}º Aditivo`),
        kind: input.kind,
        description: input.description,
        signedAt: date(input.signedAt) ?? null,
        effectiveFrom: date(input.effectiveFrom) ?? null,
        newEndDate: date(input.newEndDate) ?? null,
        newMonthlyValue,
        newObject: input.newObject,
        adjustmentIndex: input.kind === 'ADJUSTMENT' ? input.adjustmentIndex ?? null : null,
        adjustmentPercent: input.kind === 'ADJUSTMENT' && input.adjustmentPercent !== null && input.adjustmentPercent !== undefined ? new Prisma.Decimal(input.adjustmentPercent) : null,
        documentId: input.documentId,
        origin: 'MANUAL',
      },
    });
    // Aditivo aplica seus efeitos ao contrato (histórico fica no aditivo)
    const patch: Prisma.ContractUpdateInput = {};
    if (created.newEndDate) {
      patch.endDate = created.newEndDate;
      // Aditivo de prazo com nova vigência futura reativa contrato vencido/encerrado (protótipo aprovado).
      if (created.newEndDate >= new Date(new Date().toISOString().slice(0, 10)) && (contract.status === 'EXPIRED' || contract.status === 'TERMINATED')) patch.status = 'ACTIVE';
    }
    if (created.newMonthlyValue) patch.monthlyValue = created.newMonthlyValue;
    if (created.newObject) patch.object = created.newObject;
    if (Object.keys(patch).length) await tx.contract.update({ where: { id: contractId }, data: { ...patch, origin: 'MANUAL' } });
    return created;
  });
  await audit(ctx, { action: 'AMENDMENT_ADDED', resource: 'contract', resourceId: contractId, after: a });
  return a;
}

/**
 * Valores "originais" do contrato (antes de qualquer aditivo): último snapshot
 * CREATE/UPDATE auditado anterior ao primeiro aditivo. Sem snapshot, mantém o
 * valor atual do contrato.
 */
async function baselineValues(contract: { id: string; endDate: Date | null; monthlyValue: Prisma.Decimal | null; object: string | null }, firstAmendmentAt: Date | null) {
  const snap = await prisma.auditLog.findFirst({
    where: { resource: 'contract', resourceId: contract.id, action: { in: ['CREATE', 'UPDATE'] }, ...(firstAmendmentAt ? { createdAt: { lt: firstAmendmentAt } } : {}) },
    orderBy: { createdAt: 'desc' },
    select: { after: true },
  });
  const after = (snap?.after ?? null) as { endDate?: string | null; monthlyValue?: string | number | null; object?: string | null } | null;
  return {
    endDate: after && 'endDate' in after ? (after.endDate ? new Date(after.endDate) : null) : contract.endDate,
    monthlyValue: after && 'monthlyValue' in after ? (after.monthlyValue !== null && after.monthlyValue !== undefined ? new Prisma.Decimal(String(after.monthlyValue)) : null) : contract.monthlyValue,
    object: after && 'object' in after ? (after.object ?? null) : contract.object,
  };
}

/** Remove um aditivo e recompõe endDate/monthlyValue/object a partir dos aditivos restantes (ou dos valores originais). */
export async function removeAmendment(ctx: Ctx, contractId: string, amendmentId: string): Promise<void> {
  const contract = await get(contractId);
  const a = contract.amendments.find((x) => x.id === amendmentId);
  if (!a) throw notFound('Aditivo não encontrado');
  const remaining = contract.amendments.filter((x) => x.id !== amendmentId);
  const firstAt = contract.amendments.reduce<Date | null>((min, x) => (!min || x.createdAt < min ? x.createdAt : min), null);
  const base = await baselineValues(contract, firstAt);
  let endDate = base.endDate;
  let monthlyValue = base.monthlyValue;
  let object = base.object;
  for (const r of remaining) {
    if (r.newEndDate) endDate = r.newEndDate;
    if (r.newMonthlyValue) monthlyValue = r.newMonthlyValue;
    if (r.newObject) object = r.newObject;
  }
  const after = await prisma.$transaction(async (tx) => {
    await tx.contractAmendment.delete({ where: { id: amendmentId } });
    return tx.contract.update({ where: { id: contractId }, data: { endDate, monthlyValue, object, origin: 'MANUAL' } });
  });
  await audit(ctx, {
    action: 'AMENDMENT_REMOVED', resource: 'contract', resourceId: contractId,
    before: { amendment: { ...a, document: undefined }, endDate: contract.endDate, monthlyValue: contract.monthlyValue, object: contract.object },
    after: { endDate: after.endDate, monthlyValue: after.monthlyValue, object: after.object },
  });
}

// ---------------- documentos ----------------
export const CONTRACT_DOC_MAX_SIZE = 25 * 1024 * 1024;

/** Anexa um PDF ao contrato (tipo padrão CONTRACT; aceita AMENDMENT_REQUEST/OTHER). */
export async function addDocument(ctx: Ctx, contractId: string, file: File, opts: { type?: 'CONTRACT' | 'AMENDMENT_REQUEST' | 'OTHER'; name?: string }) {
  const contract = await get(contractId);
  const mimeType = file.type || 'application/octet-stream';
  if (mimeType !== 'application/pdf') throw badRequest('Envie um arquivo PDF');
  if (file.size > CONTRACT_DOC_MAX_SIZE) throw badRequest('Arquivo excede 25 MB');
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length === 0) throw badRequest('Arquivo vazio');
  const result = await storeDocument({
    buffer,
    mimeType,
    name: opts.name ?? file.name ?? `Contrato ${contract.number}.pdf`,
    type: opts.type ?? 'CONTRACT',
    entityId: contract.entityId,
    contractId,
    uploadedByUserId: ctx.user.id,
    origin: 'MANUAL',
  });
  await audit(ctx, { action: 'DOCUMENT_UPLOADED', resource: 'contract', resourceId: contractId, after: { documentId: result.documentId, type: opts.type ?? 'CONTRACT', size: buffer.length, deduplicated: result.deduplicated } });
  return getDocument(result.documentId);
}

// ---------------- conta corrente ----------------
/**
 * Conta corrente do contrato (spec §23): mês a mês, quanto deveria ter sido
 * faturado (valor mensal vigente, considerando aditivos de valor), quanto foi
 * faturado, pago e pendente. Distingue "não houve nota" de "nota não paga".
 */
export async function ledger(contractId: string): Promise<ContractLedger> {
  const contract = await prisma.contract.findFirst({
    where: { id: contractId, deletedAt: null },
    include: { amendments: { orderBy: { sequence: 'asc' } }, invoices: { where: { deletedAt: null } } },
  });
  if (!contract) throw notFound('Contrato não encontrado');

  const today = todayIso();
  const start = dateToIso(contract.startDate);
  const endRaw = dateToIso(contract.endDate);
  // Encerra a janela hoje quando o contrato ainda está vigente/sem fim informado
  const end = endRaw && endRaw < today ? endRaw : today;

  const months: ContractLedgerMonth[] = [];
  const totals = { expected: 0, invoiced: 0, paid: 0, pending: 0, monthsNotInvoiced: 0, monthsPending: 0 };

  if (start) {
    const byComp = new Map<string, typeof contract.invoices>();
    for (const inv of contract.invoices) {
      const key = `${inv.competenceYear}-${String(inv.competenceMonth).padStart(2, '0')}`;
      byComp.set(key, [...(byComp.get(key) ?? []), inv]);
    }
    const currentComp = today.slice(0, 7);
    for (const c of competencesBetween(start, end)) {
      const key = `${c.year}-${String(c.month).padStart(2, '0')}`;
      const expected = contract.expectsMonthlyBilling ? monthlyValueAt(contract, key) : 0;
      const invs = byComp.get(key) ?? [];
      const invoiced = invs.filter((i) => i.status !== 'CANCELLED').reduce((s, i) => s + Number(i.amount), 0);
      const paid = invs.filter((i) => i.status === 'PAID').reduce((s, i) => s + Number(i.paidAmount ?? i.amount), 0);
      const pending = invs.filter((i) => i.status === 'PENDING').reduce((s, i) => s + Number(i.amount), 0);
      let state: ContractLedgerMonth['state'];
      if (invs.length === 0) state = key >= currentComp ? 'FUTURE' : 'NOT_INVOICED';
      else if (pending > 0 && paid > 0) state = 'PARTIAL';
      else if (pending > 0) state = 'PENDING';
      else state = 'PAID';
      if (state === 'NOT_INVOICED' && expected > 0) totals.monthsNotInvoiced += 1;
      if (state === 'PENDING' || state === 'PARTIAL') totals.monthsPending += 1;
      totals.expected += state === 'FUTURE' ? 0 : expected;
      totals.invoiced += invoiced;
      totals.paid += paid;
      totals.pending += pending;
      months.push({ competence: key, expected: toDecimalString(expected), invoiced: toDecimalString(invoiced), paid: toDecimalString(paid), pending: toDecimalString(pending), invoiceCount: invs.length, state });
    }
  }

  // notas fora da vigência (ex.: competências anteriores ao início) entram nos totais
  const lastPaid = contract.invoices.filter((i) => i.status === 'PAID' && i.paidAt).sort((a, b) => b.paidAt!.getTime() - a.paidAt!.getTime())[0];

  return {
    contractId: contract.id,
    contractNumber: contract.number,
    status: contract.status,
    monthlyValue: contract.monthlyValue ? contract.monthlyValue.toFixed(2) : null,
    startDate: start,
    endDate: endRaw,
    totals: {
      expected: toDecimalString(totals.expected),
      invoiced: toDecimalString(totals.invoiced),
      paid: toDecimalString(totals.paid),
      pending: toDecimalString(totals.pending),
      monthsNotInvoiced: totals.monthsNotInvoiced,
      monthsPending: totals.monthsPending,
      lastPaymentAt: lastPaid ? dateToIso(lastPaid.paidAt) : null,
      lastPaymentAmount: lastPaid ? (lastPaid.paidAmount ?? lastPaid.amount).toFixed(2) : null,
    },
    months: months.reverse(),
  };
}

/** Valor mensal vigente numa competência: último aditivo de valor com effectiveFrom <= competência, senão o do contrato. */
function monthlyValueAt(
  contract: { monthlyValue: Prisma.Decimal | null; amendments: Array<{ newMonthlyValue: Prisma.Decimal | null; effectiveFrom: Date | null; signedAt: Date | null }> },
  competence: string,
): number {
  let value = contract.monthlyValue ? Number(contract.monthlyValue) : 0;
  for (const a of contract.amendments) {
    if (!a.newMonthlyValue) continue;
    const from = dateToIso(a.effectiveFrom ?? a.signedAt);
    if (!from || from.slice(0, 7) <= competence) value = Number(a.newMonthlyValue);
  }
  return value;
}


// ---------------- ciclo de vida (Fase 3) ----------------
/** Ativa um contrato em RASCUNHO (confirmação explícita da contratação). Pode ajustar vigência/valor e criar o alarme de emissão. */
export async function activate(ctx: Ctx, id: string, input: z.infer<typeof activateContractSchema>) {
  const before = await get(id);
  if (before.status !== 'DRAFT') throw badRequest('Só contratos em rascunho podem ser ativados');
  const c = await prisma.contract.update({
    where: { id },
    data: { status: 'ACTIVE', activatedAt: new Date(), startDate: date(input.startDate), endDate: date(input.endDate), monthlyValue: dec(input.monthlyValue), notes: input.notes === undefined ? undefined : input.notes, origin: 'MANUAL' },
  });
  if (input.issuanceDay) await createAlarm(ctx, { entityId: c.entityId, contractNumber: c.number, label: 'Emissão da nota', dayOfMonth: input.issuanceDay, leadDays: 5, notes: `Criado na ativação do contrato ${c.number}` });
  if (before.opportunityId) await prisma.opportunityEvent.create({ data: { opportunityId: before.opportunityId, userId: ctx.user.id, action: 'CONTRACT_ACTIVATED', toValue: c.number } }).catch(() => undefined);
  await audit(ctx, { action: 'CONTRACT_ACTIVATED', resource: 'contract', resourceId: id, before: { status: before.status }, after: { status: c.status, startDate: c.startDate, endDate: c.endDate, monthlyValue: c.monthlyValue } });
  return c;
}

/** Encerra o contrato (rescisão/término antecipado): registra data e motivo, cancela renovações em aberto e tarefas de renovação. */
export async function terminate(ctx: Ctx, id: string, input: z.infer<typeof terminateContractSchema>) {
  const before = await get(id);
  if (before.status === 'TERMINATED') throw badRequest('Contrato já encerrado');
  const c = await prisma.$transaction(async (tx) => {
    const updated = await tx.contract.update({ where: { id }, data: { status: 'TERMINATED', terminatedAt: isoToDate(input.date), terminationReason: input.reason, notes: input.notes ? `${before.notes ? before.notes + '\n' : ''}Encerramento: ${input.notes}` : undefined, origin: 'MANUAL' } });
    const open = await tx.contractRenewal.findMany({ where: { contractId: id, status: 'OPEN' } });
    for (const r of open) {
      await tx.contractRenewal.update({ where: { id: r.id }, data: { status: 'CANCELLED', decidedAt: new Date(), decidedByUserId: ctx.user.id, notes: `Contrato encerrado: ${input.reason}` } });
      if (r.taskId) await tx.financialTask.updateMany({ where: { id: r.taskId, status: { in: ['PENDING', 'IN_PROGRESS'] } }, data: { status: 'CANCELLED' } });
    }
    return updated;
  });
  await audit(ctx, { action: 'CONTRACT_TERMINATED', resource: 'contract', resourceId: id, before: { status: before.status, endDate: before.endDate }, after: { status: 'TERMINATED', terminatedAt: input.date, reason: input.reason }, justification: input.notes ?? input.reason });
  return c;
}

/** Reajuste manual com índice informado (nenhum índice é consultado automaticamente): vira um aditivo ADJUSTMENT. */
export async function adjust(ctx: Ctx, id: string, input: z.infer<typeof adjustContractSchema>) {
  const contract = await get(id);
  if (contract.status !== 'ACTIVE') throw badRequest('Só contratos ativos podem ser reajustados');
  return addAmendment(ctx, id, {
    kind: 'ADJUSTMENT', label: input.label ?? `Reajuste ${input.indexName}`, description: input.description ?? `Reajuste de ${input.percent}% (${input.indexName})`,
    signedAt: input.signedAt ?? null, effectiveFrom: input.effectiveFrom, newMonthlyValue: input.newMonthlyValue ?? null, adjustmentIndex: input.indexName, adjustmentPercent: input.percent,
    newEndDate: null, newObject: null, documentId: null,
  });
}

/**
 * Situação financeira do contrato (spec módulo 4/5): PREVISTO (contrato), FATURADO e RECEBIDO (Financeiro) e PENDENTE,
 * sempre separados. Reutiliza a conta corrente para o esperado mês a mês.
 */
export async function financialStatus(id: string): Promise<ContractFinancialStatus> {
  const [c, led] = await Promise.all([
    prisma.contract.findFirst({ where: { id, deletedAt: null }, include: { amendments: { orderBy: { sequence: 'asc' } }, invoices: { where: { deletedAt: null } }, renewals: { orderBy: { createdAt: 'desc' }, take: 1 } } }),
    ledger(id),
  ]);
  if (!c) throw notFound('Contrato não encontrado');
  const today = todayIso();
  const end = dateToIso(c.endDate);
  const monthly = Number(led.monthlyValue ?? 0) ? monthlyValueAt(c, today.slice(0, 7)) : 0;
  const remainingMonths = c.status === 'ACTIVE' && end && end > today ? competencesBetween(today, end).length : 0;
  const notCancelled = c.invoices.filter((i) => i.status !== 'CANCELLED');
  const paid = c.invoices.filter((i) => i.status === 'PAID');
  const pending = c.invoices.filter((i) => i.status === 'PENDING');
  const sum = (xs: Array<{ amount: Prisma.Decimal; paidAmount?: Prisma.Decimal | null }>, usePaid = false) => xs.reduce((a, i) => a.add(usePaid ? i.paidAmount ?? i.amount : i.amount), new Prisma.Decimal(0));
  const lastInvoiced = notCancelled.filter((i) => i.issueDate).sort((a, b) => b.issueDate!.getTime() - a.issueDate!.getTime())[0];
  const lastPaid = paid.filter((i) => i.paidAt).sort((a, b) => b.paidAt!.getTime() - a.paidAt!.getTime())[0];
  const oldestPending = pending.filter((i) => i.issueDate).sort((a, b) => a.issueDate!.getTime() - b.issueDate!.getTime())[0];
  const years = new Map<number, { expected: Prisma.Decimal; invoiced: Prisma.Decimal; received: Prisma.Decimal; pending: Prisma.Decimal }>();
  const y = (n: number) => { let e = years.get(n); if (!e) { e = { expected: new Prisma.Decimal(0), invoiced: new Prisma.Decimal(0), received: new Prisma.Decimal(0), pending: new Prisma.Decimal(0) }; years.set(n, e); } return e; };
  for (const m of led.months) { if (m.state !== 'FUTURE') y(Number(m.competence.slice(0, 4))).expected = y(Number(m.competence.slice(0, 4))).expected.add(m.expected); }
  for (const i of notCancelled) { const e = y(i.competenceYear); e.invoiced = e.invoiced.add(i.amount); if (i.status === 'PAID') e.received = e.received.add(i.paidAmount ?? i.amount); if (i.status === 'PENDING') e.pending = e.pending.add(i.amount); }
  const r = c.renewals[0];
  return {
    contractId: c.id, status: c.status, monthlyValue: led.monthlyValue, startDate: led.startDate, endDate: end, daysToEnd: end ? daysBetween(today, end) : null,
    forecast: { monthly: monthly.toFixed(2), remainingMonths, remainingAmount: (monthly * remainingMonths).toFixed(2), expectedToDate: led.totals.expected, contractTotal: c.totalValue ? c.totalValue.toFixed(2) : null },
    invoiced: { total: sum(notCancelled).toFixed(2), count: notCancelled.length, lastAt: lastInvoiced ? dateToIso(lastInvoiced.issueDate) : null },
    received: { total: sum(paid, true).toFixed(2), count: paid.length, lastAt: lastPaid ? dateToIso(lastPaid.paidAt) : null, lastAmount: lastPaid ? (lastPaid.paidAmount ?? lastPaid.amount).toFixed(2) : null },
    pending: { total: sum(pending).toFixed(2), count: pending.length, oldestDays: oldestPending ? daysBetween(dateToIso(oldestPending.issueDate)!, today) : null },
    monthsNotInvoiced: led.totals.monthsNotInvoiced,
    byYear: [...years.entries()].sort(([a], [b]) => a - b).map(([year, e]) => ({ year, expected: e.expected.toFixed(2), invoiced: e.invoiced.toFixed(2), received: e.received.toFixed(2), pending: e.pending.toFixed(2) })),
    renewal: r ? { id: r.id, status: r.status, endDate: dateToIso(r.endDate)!, opportunityId: r.opportunityId, taskId: r.taskId } : null,
    adjustments: c.amendments.filter((a) => a.kind === 'ADJUSTMENT').map((a) => ({ id: a.id, label: a.label, indexName: a.adjustmentIndex, percent: a.adjustmentPercent ? a.adjustmentPercent.toFixed(2) : null, effectiveFrom: dateToIso(a.effectiveFrom), newMonthlyValue: a.newMonthlyValue ? a.newMonthlyValue.toFixed(2) : null })),
  };
}
void orgId;
