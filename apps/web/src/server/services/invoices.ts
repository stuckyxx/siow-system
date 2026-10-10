/**
 * Notas fiscais: listagem, detalhe, alteração manual protegida (override),
 * reconciliação, resolução de conflitos de sync e captura de documento.
 */
import { Prisma } from '@siow/db';
import { getProvider, type DocumentRef, type ProviderContext } from '@siow/integrations';
import { daysBetween, dateToIso, isoToDate, todayIso, type BulkInvoiceStatusDto, type InvoiceListFilter, type InvoiceOverrideDto, type InvoiceRow, type Paginated } from '@siow/shared';
import type { z } from 'zod';
import type { createManualInvoiceSchema, reconcileInvoiceSchema, resolveConflictSchema } from '@siow/shared';
import { prisma } from '../db.js';
import { audit } from '../audit.js';
import { badRequest, conflict as conflictError, notFound, type Ctx } from '../http.js';
import { storeDocument } from './documents.js';

const SORT: Record<string, Prisma.InvoiceOrderByWithRelationInput> = {
  issueDate: { issueDate: 'desc' },
  amount: { amount: 'desc' },
  number: { number: 'desc' },
  competence: { competenceYear: 'desc' },
  paidAt: { paidAt: 'desc' },
  entity: { entity: { name: 'asc' } },
};

/** Constrói o WHERE de notas a partir dos filtros globais (reutilizado pelo dashboard e relatórios). */
export function buildInvoiceWhere(f: Partial<InvoiceListFilter> & { entityIds?: string[] }, overdueAfterDays?: number): Prisma.InvoiceWhereInput {
  const where: Prisma.InvoiceWhereInput = { deletedAt: null };
  if (f.entityId) where.entityId = f.entityId;
  if (f.entityIds) where.entityId = { in: f.entityIds };
  if (f.contractId) where.contractId = f.contractId;
  if (f.status && f.status !== 'ALL') where.status = f.status;
  if (f.year) where.competenceYear = f.year;
  if (f.month) where.competenceMonth = f.month;
  if (f.needsReconciliation !== undefined) where.needsReconciliation = f.needsReconciliation;
  const entity: Prisma.EntityWhereInput = {};
  if (f.entityType) entity.type = f.entityType;
  if (f.uf) entity.uf = f.uf.toUpperCase();
  if (f.municipality) entity.municipality = { equals: f.municipality, mode: 'insensitive' };
  if (f.responsibleUserId) entity.responsibleUserId = f.responsibleUserId;
  if (Object.keys(entity).length) where.entity = entity;
  if (f.competenceFrom || f.competenceTo) {
    const range: Prisma.InvoiceWhereInput[] = [];
    const from = f.competenceFrom ? { y: Number(f.competenceFrom.slice(0, 4)), m: Number(f.competenceFrom.slice(5, 7)) } : null;
    const to = f.competenceTo ? { y: Number(f.competenceTo.slice(0, 4)), m: Number(f.competenceTo.slice(5, 7)) } : null;
    if (from) range.push({ OR: [{ competenceYear: { gt: from.y } }, { competenceYear: from.y, competenceMonth: { gte: from.m } }] });
    if (to) range.push({ OR: [{ competenceYear: { lt: to.y } }, { competenceYear: to.y, competenceMonth: { lte: to.m } }] });
    where.AND = range;
  }
  if (f.issueFrom || f.issueTo) where.issueDate = { gte: f.issueFrom ? isoToDate(f.issueFrom) : undefined, lte: f.issueTo ? isoToDate(f.issueTo) : undefined };
  if (f.paidFrom || f.paidTo) where.paidAt = { gte: f.paidFrom ? isoToDate(f.paidFrom) : undefined, lte: f.paidTo ? isoToDate(f.paidTo) : undefined };
  if (f.q) {
    where.OR = [
      { number: { contains: f.q, mode: 'insensitive' } },
      { entity: { name: { contains: f.q, mode: 'insensitive' } } },
      { entity: { municipality: { contains: f.q, mode: 'insensitive' } } },
      { contract: { number: { contains: f.q, mode: 'insensitive' } } },
    ];
  }
  void overdueAfterDays;
  return where;
}

export function daysOverdue(inv: { status: string; issueDate: Date | null }, today: string, overdueAfterDays: number): number | null {
  if (inv.status !== 'PENDING' || !inv.issueDate) return null;
  const days = daysBetween(dateToIso(inv.issueDate)!, today) - overdueAfterDays;
  return days > 0 ? days : 0;
}

const listInclude = {
  entity: { select: { id: true, name: true, type: true } },
  contract: { select: { id: true, number: true } },
  collectionCase: { select: { status: true } },
  _count: { select: { documents: true } },
} satisfies Prisma.InvoiceInclude;
type InvoiceWithRels = Prisma.InvoiceGetPayload<{ include: typeof listInclude }>;

export async function overdueAfterDays(): Promise<number> {
  const s = await prisma.setting.findUnique({ where: { key: 'invoices.overdueAfterDays' } });
  return typeof s?.value === 'number' ? s.value : 30;
}

export function toRow(inv: InvoiceWithRels, today: string, overdueAfter: number): InvoiceRow {
  return {
    id: inv.id,
    entityId: inv.entityId,
    entityName: inv.entity.name,
    entityType: inv.entity.type,
    contractId: inv.contractId,
    contractNumber: inv.contract?.number ?? null,
    number: inv.number,
    competenceMonth: inv.competenceMonth,
    competenceYear: inv.competenceYear,
    amount: inv.amount.toFixed(2),
    issueDate: dateToIso(inv.issueDate),
    status: inv.status,
    paidAt: dateToIso(inv.paidAt),
    daysOverdue: daysOverdue(inv, today, overdueAfter),
    needsReconciliation: inv.needsReconciliation,
    manualOverride: inv.manualOverride,
    collectionStatus: inv.collectionCase?.status ?? null,
    hasDocument: inv._count.documents > 0,
  };
}

export async function list(f: InvoiceListFilter): Promise<Paginated<InvoiceRow> & { totals: { amount: string; count: number } }> {
  const where = buildInvoiceWhere(f);
  const orderBy = SORT[f.sortBy ?? 'issueDate'] ?? SORT['issueDate']!;
  const dir = f.sortDir;
  const order = Object.fromEntries(Object.entries(orderBy).map(([k, v]) => [k, typeof v === 'string' ? dir : v])) as Prisma.InvoiceOrderByWithRelationInput;
  const [items, total, agg, overdueAfter] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: listInclude,
      orderBy: [order, { competenceYear: 'desc' }, { competenceMonth: 'desc' }],
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
    }),
    prisma.invoice.count({ where }),
    prisma.invoice.aggregate({ where, _sum: { amount: true } }),
    overdueAfterDays(),
  ]);
  const today = todayIso();
  return { items: items.map((i) => toRow(i, today, overdueAfter)), total, page: f.page, pageSize: f.pageSize, totals: { amount: (agg._sum.amount ?? new Prisma.Decimal(0)).toFixed(2), count: total } };
}

export async function get(id: string) {
  const inv = await prisma.invoice.findFirst({
    where: { id, deletedAt: null },
    include: {
      entity: { select: { id: true, name: true, shortName: true, type: true, municipality: true, uf: true } },
      contract: { select: { id: true, number: true, endDate: true } },
      dataSource: { select: { id: true, url: true, provider: true } },
      documents: { where: { deletedAt: null }, include: { blob: { select: { size: true, mimeType: true } } }, orderBy: { capturedAt: 'desc' } },
      events: { orderBy: { createdAt: 'desc' }, include: { user: { select: { id: true, name: true } } } },
      conflicts: { orderBy: { createdAt: 'desc' }, include: { resolvedBy: { select: { id: true, name: true } } } },
      collectionCase: { include: { attempts: { orderBy: { performedAt: 'desc' }, include: { performedBy: { select: { id: true, name: true } }, contact: { select: { id: true, name: true } } } }, assignee: { select: { id: true, name: true } } } },
      overriddenBy: { select: { id: true, name: true } },
      tasks: { where: { deletedAt: null }, orderBy: { dueDate: 'asc' } },
      serviceOrders: { where: { deletedAt: null } },
    },
  });
  if (!inv) throw notFound('Nota não encontrada');
  const overdueAfter = await overdueAfterDays();
  return { ...inv, amount: inv.amount.toFixed(2), paidAmount: inv.paidAmount?.toFixed(2) ?? null, daysOverdue: daysOverdue(inv, todayIso(), overdueAfter) };
}

/**
 * Alteração manual protegida (spec §26): exige permissão invoices.override e
 * justificativa (>= 10 caracteres, validada no schema). Marca a nota como
 * manualOverride — a sincronização passa a gerar conflitos em vez de
 * sobrescrever os campos alterados.
 */
export async function override(ctx: Ctx, id: string, dto: InvoiceOverrideDto) {
  const before = await prisma.invoice.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw notFound('Nota não encontrada');
  if (!dto.justification || dto.justification.trim().length < 10) throw badRequest('Justificativa deve ter pelo menos 10 caracteres');
  const data: Prisma.InvoiceUncheckedUpdateInput = { manualOverride: true, overrideJustification: dto.justification, overriddenByUserId: ctx.user.id, overriddenAt: new Date() };
  const events: Prisma.InvoiceEventUncheckedCreateInput[] = [];
  const push = (field: string, oldV: unknown, newV: unknown): void => {
    const o = oldV instanceof Date ? dateToIso(oldV) : oldV instanceof Prisma.Decimal ? oldV.toFixed(2) : oldV === null || oldV === undefined ? null : String(oldV);
    const n = newV instanceof Date ? dateToIso(newV) : newV instanceof Prisma.Decimal ? newV.toFixed(2) : newV === null || newV === undefined ? null : String(newV);
    if (o === n) return;
    (data as Record<string, unknown>)[field] = newV;
    events.push({ invoiceId: id, type: field === 'status' ? 'STATUS_CHANGED' : 'FIELD_CHANGED', field, oldValue: o, newValue: n, origin: 'MANUAL', userId: ctx.user.id, note: dto.justification });
  };
  if (dto.status !== undefined) push('status', before.status, dto.status);
  if (dto.paidAt !== undefined) push('paidAt', before.paidAt, dto.paidAt ? isoToDate(dto.paidAt) : null);
  if (dto.paidAmount !== undefined) push('paidAmount', before.paidAmount, dto.paidAmount ? new Prisma.Decimal(dto.paidAmount) : null);
  if (dto.amount !== undefined) push('amount', before.amount, new Prisma.Decimal(dto.amount));
  if (dto.contractId !== undefined) push('contractId', before.contractId, dto.contractId);
  if (dto.description !== undefined) push('description', before.description, dto.description);
  if (events.length === 0) throw badRequest('Nenhuma alteração informada');
  if ((data.status === 'PAID' || (before.status === 'PAID' && data.status === undefined)) && data.paidAt === undefined && !before.paidAt) {
    throw badRequest('Informe a data do pagamento ao marcar como paga');
  }
  if (data.status === 'PAID') {
    data.needsReconciliation = false;
    data.reconciliationNote = null;
    data.missingSince = null;
  }
  events.push({ invoiceId: id, type: 'MANUAL_OVERRIDE', origin: 'MANUAL', userId: ctx.user.id, note: dto.justification });
  const after = await prisma.$transaction(async (tx) => {
    const updated = await tx.invoice.update({ where: { id }, data });
    await tx.invoiceEvent.createMany({ data: events });
    if (updated.status === 'PAID') {
      await tx.collectionCase.updateMany({ where: { invoiceId: id, status: { not: 'SETTLED' } }, data: { status: 'SETTLED' } });
    }
    return updated;
  });
  await audit(ctx, { action: 'INVOICE_OVERRIDE', resource: 'invoice', resourceId: id, before, after, justification: dto.justification });
  return get(id);
}

export async function createManual(ctx: Ctx, dto: z.infer<typeof createManualInvoiceSchema>) {
  const exists = await prisma.invoice.findUnique({ where: { entityId_number: { entityId: dto.entityId, number: dto.number } } });
  if (exists) throw conflictError('Já existe nota com este número para a entidade');
  const inv = await prisma.invoice.create({
    data: {
      entityId: dto.entityId,
      contractId: dto.contractId ?? null,
      number: dto.number,
      competenceMonth: dto.competenceMonth,
      competenceYear: dto.competenceYear,
      amount: new Prisma.Decimal(dto.amount),
      issueDate: dto.issueDate ? isoToDate(dto.issueDate) : null,
      status: dto.status,
      paidAt: dto.paidAt ? isoToDate(dto.paidAt) : null,
      paidAmount: dto.status === 'PAID' ? new Prisma.Decimal(dto.amount) : null,
      description: dto.description,
      origin: 'MANUAL',
      manualOverride: true,
      overrideJustification: dto.justification,
      overriddenByUserId: ctx.user.id,
      overriddenAt: new Date(),
      events: { create: { type: 'CREATED', origin: 'MANUAL', userId: ctx.user.id, newValue: dto.status, note: dto.justification } },
    },
  });
  await audit(ctx, { action: 'CREATE', resource: 'invoice', resourceId: inv.id, after: inv, justification: dto.justification });
  return get(inv.id);
}

/**
 * Marca várias notas como pagas/pendentes de uma vez (ou uma só). Cada nota passa pelo mesmo caminho de
 * `override` (manualOverride + eventos + auditoria); notas já na situação pedida são puladas.
 */
export async function bulkStatus(ctx: Ctx, dto: BulkInvoiceStatusDto): Promise<{ updated: number; skipped: number; errors: Array<{ id: string; number: string | null; error: string }> }> {
  const out = { updated: 0, skipped: 0, errors: [] as Array<{ id: string; number: string | null; error: string }> };
  const rows = await prisma.invoice.findMany({ where: { id: { in: dto.ids }, deletedAt: null }, select: { id: true, number: true, status: true, paidAt: true, amount: true } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of dto.ids) {
    const inv = byId.get(id);
    if (!inv) { out.errors.push({ id, number: null, error: 'Nota não encontrada' }); continue; }
    if (inv.status === dto.status) { out.skipped += 1; continue; }
    try {
      const patch: InvoiceOverrideDto = { status: dto.status, justification: dto.justification };
      if (dto.status === 'PAID') {
        patch.paidAt = dto.paidAt ?? (inv.paidAt ? dateToIso(inv.paidAt) : todayIso());
        patch.paidAmount = inv.amount.toFixed(2);
      } else {
        patch.paidAt = null;
        patch.paidAmount = null;
      }
      await override(ctx, id, patch);
      out.updated += 1;
    } catch (e) {
      out.errors.push({ id, number: inv.number, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

/** Resolve uma nota marcada como "necessita verificação" (sumiu da fonte, regressão de status...). */
export async function reconcile(ctx: Ctx, id: string, dto: z.infer<typeof reconcileInvoiceSchema>) {
  const before = await prisma.invoice.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw notFound('Nota não encontrada');
  if (dto.status === 'PAID' && !dto.paidAt && !before.paidAt) throw badRequest('Informe a data do pagamento');
  const after = await prisma.$transaction(async (tx) => {
    const updated = await tx.invoice.update({
      where: { id },
      data: {
        status: dto.status,
        paidAt: dto.paidAt ? isoToDate(dto.paidAt) : undefined,
        paidAmount: dto.status === 'PAID' ? (before.paidAmount ?? before.amount) : undefined,
        needsReconciliation: false,
        reconciliationNote: null,
        // Se a nota sumiu da fonte e o usuário confirmou o status, protegemos contra reversão automática
        manualOverride: before.missingSince ? true : before.manualOverride,
        overrideJustification: before.missingSince ? dto.note : before.overrideJustification,
        overriddenByUserId: before.missingSince ? ctx.user.id : before.overriddenByUserId,
        overriddenAt: before.missingSince ? new Date() : before.overriddenAt,
      },
    });
    await tx.invoiceEvent.create({ data: { invoiceId: id, type: 'RECONCILED', field: 'status', oldValue: before.status, newValue: dto.status, origin: 'MANUAL', userId: ctx.user.id, note: dto.note } });
    if (dto.status === 'PAID') await tx.collectionCase.updateMany({ where: { invoiceId: id }, data: { status: 'SETTLED' } });
    return updated;
  });
  await audit(ctx, { action: 'INVOICE_RECONCILED', resource: 'invoice', resourceId: id, before, after, justification: dto.note });
  return get(id);
}

export async function resolveConflict(ctx: Ctx, invoiceId: string, conflictId: string, dto: z.infer<typeof resolveConflictSchema>) {
  const conflict = await prisma.syncConflict.findFirst({ where: { id: conflictId, invoiceId, status: 'OPEN' } });
  if (!conflict) throw notFound('Conflito não encontrado ou já resolvido');
  await prisma.$transaction(async (tx) => {
    await tx.syncConflict.update({ where: { id: conflictId }, data: { status: dto.resolution, resolvedByUserId: ctx.user.id, resolvedAt: new Date(), resolutionNote: dto.note } });
    if (dto.resolution === 'ACCEPTED_SOURCE') {
      const value = conflict.sourceValue;
      const data: Record<string, unknown> = {};
      if (conflict.field === 'status') data['status'] = value;
      else if (conflict.field === 'paidAt') data['paidAt'] = value ? isoToDate(value) : null;
      else if (conflict.field === 'amount') data['amount'] = value ? new Prisma.Decimal(value) : undefined;
      await tx.invoice.update({ where: { id: invoiceId }, data });
    }
    await tx.invoiceEvent.create({
      data: { invoiceId, type: 'CONFLICT_RESOLVED', field: conflict.field, oldValue: conflict.manualValue, newValue: dto.resolution === 'ACCEPTED_SOURCE' ? conflict.sourceValue : conflict.manualValue, origin: 'MANUAL', userId: ctx.user.id, note: dto.note },
    });
  });
  await audit(ctx, { action: 'CONFLICT_RESOLVED', resource: 'invoice', resourceId: invoiceId, before: conflict, after: dto });
  return get(invoiceId);
}

const providerCtx = (): ProviderContext => ({
  timeoutMs: Number(process.env['SYNC_HTTP_TIMEOUT_MS'] ?? 20_000),
  userAgent: process.env['SYNC_USER_AGENT'] ?? 'SiowSystem/1.0',
});

/**
 * Captura o PDF da nota (e o recibo, se houver) direto do portal, dentro da
 * requisição (substitui o job BullMQ). O acesso à nota tem efeito colateral no
 * portal, por isso só acontece sob demanda de um usuário e é auditado.
 */
export async function captureDocument(ctx: Ctx, id: string) {
  const inv = await prisma.invoice.findFirst({ where: { id, deletedAt: null }, include: { entity: true, dataSource: true } });
  if (!inv) throw notFound('Nota não encontrada');
  if (!inv.documentUrl) throw badRequest('Nota sem link de documento na origem');
  const provider = getProvider(inv.dataSource?.provider ?? 'ASSESI_PORTAL');
  await audit(ctx, { action: 'DOCUMENT_CAPTURE_REQUESTED', resource: 'invoice', resourceId: id });

  const ref: DocumentRef = { kind: 'INVOICE', url: inv.documentUrl, method: 'POST', form: inv.externalId ? { idNota: inv.externalId } : {}, sideEffects: true };
  const file = await provider.fetchDocument(ref, providerCtx());
  const doc = await storeDocument({
    buffer: file.buffer,
    mimeType: file.mimeType,
    name: `NF ${inv.number} - ${inv.entity.shortName ?? inv.entity.name}.pdf`,
    type: 'INVOICE',
    entityId: inv.entityId,
    contractId: inv.contractId,
    invoiceId: inv.id,
    originalUrl: inv.documentUrl,
    sourceDate: inv.issueDate,
    uploadedByUserId: ctx.user.id,
    origin: 'SYNC',
  });
  await audit(ctx, { action: 'DOCUMENT_CAPTURED', resource: 'invoice', resourceId: id, after: { type: 'INVOICE', documentId: doc.documentId, originalUrl: inv.documentUrl } });

  let receiptDocumentId: string | null = null;
  if (inv.receiptUrl) {
    const already = await prisma.document.findFirst({ where: { invoiceId: inv.id, type: 'RECEIPT', deletedAt: null }, select: { id: true } });
    if (already) receiptDocumentId = already.id;
    else {
      try {
        const rec = await provider.fetchDocument({ kind: 'RECEIPT', url: inv.receiptUrl, method: 'GET' }, providerCtx());
        const stored = await storeDocument({
          buffer: rec.buffer,
          mimeType: rec.mimeType,
          name: `Recibo NF ${inv.number}.pdf`,
          type: 'RECEIPT',
          entityId: inv.entityId,
          contractId: inv.contractId,
          invoiceId: inv.id,
          originalUrl: inv.receiptUrl,
          sourceDate: inv.paidAt,
          origin: 'SYNC',
        });
        receiptDocumentId = stored.documentId;
      } catch (e) {
        console.error('falha ao capturar recibo', e); // recibo é opcional: não falha a captura da nota
      }
    }
  }
  return { queued: false, captured: true, documentId: doc.documentId, receiptDocumentId };
}

export async function softDelete(ctx: Ctx, id: string, justification: string): Promise<void> {
  const before = await prisma.invoice.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw notFound('Nota não encontrada');
  await prisma.invoice.update({ where: { id }, data: { deletedAt: new Date(), events: { create: { type: 'NOTE', origin: 'MANUAL', userId: ctx.user.id, note: `Excluída: ${justification}` } } } });
  await audit(ctx, { action: 'SOFT_DELETE', resource: 'invoice', resourceId: id, before, justification });
}
