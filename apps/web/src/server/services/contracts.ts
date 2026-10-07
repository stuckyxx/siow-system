/**
 * Contratos, aditivos (ContractAmendment), documentos e conta corrente (ledger).
 */
import { Prisma } from '@siow/db';
import { competencesBetween, dateToIso, isoToDate, todayIso, toDecimalString, type ContractLedger, type ContractLedgerMonth } from '@siow/shared';
import type { z } from 'zod';
import type { createAmendmentSchema, createContractSchema, updateContractSchema } from '@siow/shared';
import { prisma } from '../db.js';
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
  const a = await prisma.$transaction(async (tx) => {
    const created = await tx.contractAmendment.create({
      data: {
        contractId,
        sequence,
        label: input.label ?? `${sequence}º Aditivo`,
        kind: input.kind,
        description: input.description,
        signedAt: date(input.signedAt) ?? null,
        effectiveFrom: date(input.effectiveFrom) ?? null,
        newEndDate: date(input.newEndDate) ?? null,
        newMonthlyValue: dec(input.newMonthlyValue) ?? null,
        newObject: input.newObject,
        documentId: input.documentId,
        origin: 'MANUAL',
      },
    });
    // Aditivo aplica seus efeitos ao contrato (histórico fica no aditivo)
    const patch: Prisma.ContractUpdateInput = {};
    if (created.newEndDate) patch.endDate = created.newEndDate;
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
