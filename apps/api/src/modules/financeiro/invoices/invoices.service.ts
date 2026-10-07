import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@siow/db';
import { JOB_NAMES, type QueueSet } from '@siow/queue';
import { daysBetween, dateToIso, isoToDate, todayIso, type InvoiceListFilter, type InvoiceOverrideDto, type InvoiceRow, type Paginated } from '@siow/shared';
import type { z } from 'zod';
import type { createManualInvoiceSchema, reconcileInvoiceSchema, resolveConflictSchema } from '@siow/shared';
import { AuditService } from '../../../common/audit/audit.service.js';
import type { RequestContext } from '../../../common/auth/decorators.js';
import { QUEUES_TOKEN } from '../../../common/infra/infra.module.js';
import { PrismaService } from '../../../common/prisma/prisma.service.js';

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

type InvoiceWithRels = Prisma.InvoiceGetPayload<{
  include: { entity: { select: { id: true; name: true; type: true } }; contract: { select: { id: true; number: true } }; collectionCase: { select: { status: true } }; _count: { select: { documents: true } } };
}>;

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(QUEUES_TOKEN) private readonly queues: QueueSet,
  ) {}

  private async overdueAfterDays(): Promise<number> {
    const s = await this.prisma.setting.findUnique({ where: { key: 'invoices.overdueAfterDays' } });
    return typeof s?.value === 'number' ? s.value : 30;
  }

  toRow(inv: InvoiceWithRels, today: string, overdueAfter: number): InvoiceRow {
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

  async list(f: InvoiceListFilter): Promise<Paginated<InvoiceRow> & { totals: { amount: string; count: number } }> {
    const where = buildInvoiceWhere(f);
    const orderBy = SORT[f.sortBy ?? 'issueDate'] ?? SORT['issueDate']!;
    const dir = f.sortDir;
    const order = Object.fromEntries(Object.entries(orderBy).map(([k, v]) => [k, typeof v === 'string' ? dir : v])) as Prisma.InvoiceOrderByWithRelationInput;
    const [items, total, agg, overdueAfter] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        include: { entity: { select: { id: true, name: true, type: true } }, contract: { select: { id: true, number: true } }, collectionCase: { select: { status: true } }, _count: { select: { documents: true } } },
        orderBy: [order, { competenceYear: 'desc' }, { competenceMonth: 'desc' }],
        skip: (f.page - 1) * f.pageSize,
        take: f.pageSize,
      }),
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.aggregate({ where, _sum: { amount: true } }),
      this.overdueAfterDays(),
    ]);
    const today = todayIso();
    return { items: items.map((i) => this.toRow(i, today, overdueAfter)), total, page: f.page, pageSize: f.pageSize, totals: { amount: (agg._sum.amount ?? new Prisma.Decimal(0)).toFixed(2), count: total } };
  }

  async get(id: string) {
    const inv = await this.prisma.invoice.findFirst({
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
    if (!inv) throw new NotFoundException('Nota não encontrada');
    const overdueAfter = await this.overdueAfterDays();
    return { ...inv, amount: inv.amount.toFixed(2), paidAmount: inv.paidAmount?.toFixed(2) ?? null, daysOverdue: daysOverdue(inv, todayIso(), overdueAfter) };
  }

  /**
   * Alteração manual protegida (spec §26): exige permissão invoices.override e
   * justificativa. Marca a nota como manualOverride — a sincronização passa a
   * gerar conflitos em vez de sobrescrever os campos alterados.
   */
  async override(ctx: RequestContext, id: string, dto: InvoiceOverrideDto) {
    const before = await this.prisma.invoice.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException('Nota não encontrada');
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
    if (events.length === 0) throw new BadRequestException('Nenhuma alteração informada');
    if ((data.status === 'PAID' || (before.status === 'PAID' && data.status === undefined)) && data.paidAt === undefined && !before.paidAt) {
      throw new BadRequestException('Informe a data do pagamento ao marcar como paga');
    }
    if (data.status === 'PAID') {
      data.needsReconciliation = false;
      data.reconciliationNote = null;
      data.missingSince = null;
    }
    events.push({ invoiceId: id, type: 'MANUAL_OVERRIDE', origin: 'MANUAL', userId: ctx.user.id, note: dto.justification });
    const after = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.invoice.update({ where: { id }, data });
      await tx.invoiceEvent.createMany({ data: events });
      if (updated.status === 'PAID') {
        await tx.collectionCase.updateMany({ where: { invoiceId: id, status: { not: 'SETTLED' } }, data: { status: 'SETTLED' } });
      }
      return updated;
    });
    await this.audit.log(ctx, { action: 'INVOICE_OVERRIDE', resource: 'invoice', resourceId: id, before, after, justification: dto.justification });
    return this.get(id);
  }

  async createManual(ctx: RequestContext, dto: z.infer<typeof createManualInvoiceSchema>) {
    const exists = await this.prisma.invoice.findUnique({ where: { entityId_number: { entityId: dto.entityId, number: dto.number } } });
    if (exists) throw new ConflictException('Já existe nota com este número para a entidade');
    const inv = await this.prisma.invoice.create({
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
    await this.audit.log(ctx, { action: 'CREATE', resource: 'invoice', resourceId: inv.id, after: inv, justification: dto.justification });
    return this.get(inv.id);
  }

  /** Resolve uma nota marcada como "necessita verificação" (sumiu da fonte, regressão de status...). */
  async reconcile(ctx: RequestContext, id: string, dto: z.infer<typeof reconcileInvoiceSchema>) {
    const before = await this.prisma.invoice.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException('Nota não encontrada');
    if (dto.status === 'PAID' && !dto.paidAt && !before.paidAt) throw new BadRequestException('Informe a data do pagamento');
    const after = await this.prisma.$transaction(async (tx) => {
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
    await this.audit.log(ctx, { action: 'INVOICE_RECONCILED', resource: 'invoice', resourceId: id, before, after, justification: dto.note });
    return this.get(id);
  }

  async resolveConflict(ctx: RequestContext, invoiceId: string, conflictId: string, dto: z.infer<typeof resolveConflictSchema>) {
    const conflict = await this.prisma.syncConflict.findFirst({ where: { id: conflictId, invoiceId, status: 'OPEN' } });
    if (!conflict) throw new NotFoundException('Conflito não encontrado ou já resolvido');
    await this.prisma.$transaction(async (tx) => {
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
    await this.audit.log(ctx, { action: 'CONFLICT_RESOLVED', resource: 'invoice', resourceId: invoiceId, before: conflict, after: dto });
    return this.get(invoiceId);
  }

  /** Solicita captura do PDF da nota (acesso ao portal tem efeito colateral → sob demanda, auditado). */
  async requestDocumentCapture(ctx: RequestContext, id: string) {
    const inv = await this.prisma.invoice.findFirst({ where: { id, deletedAt: null } });
    if (!inv) throw new NotFoundException('Nota não encontrada');
    if (!inv.documentUrl) throw new BadRequestException('Nota sem link de documento na origem');
    await this.queues.documents.add(JOB_NAMES.fetchDocument, { kind: 'INVOICE_DOCUMENT', invoiceId: id, requestedByUserId: ctx.user.id }, { jobId: `inv-doc-${id}-${Date.now()}` });
    if (inv.receiptUrl) await this.queues.documents.add(JOB_NAMES.fetchDocument, { kind: 'INVOICE_RECEIPT', invoiceId: id }, { jobId: `inv-rec-${id}` });
    await this.audit.log(ctx, { action: 'DOCUMENT_CAPTURE_REQUESTED', resource: 'invoice', resourceId: id });
    return { queued: true };
  }

  async softDelete(ctx: RequestContext, id: string, justification: string): Promise<void> {
    const before = await this.prisma.invoice.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException('Nota não encontrada');
    await this.prisma.invoice.update({ where: { id }, data: { deletedAt: new Date(), events: { create: { type: 'NOTE', origin: 'MANUAL', userId: ctx.user.id, note: `Excluída: ${justification}` } } } });
    await this.audit.log(ctx, { action: 'SOFT_DELETE', resource: 'invoice', resourceId: id, before, justification });
  }
}
