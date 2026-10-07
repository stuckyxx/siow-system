import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@siow/db';
import { isoToDate } from '@siow/shared';
import type { z } from 'zod';
import type { createAmendmentSchema, createContractSchema, updateContractSchema } from '@siow/shared';
import { AuditService } from '../../../common/audit/audit.service.js';
import type { RequestContext } from '../../../common/auth/decorators.js';
import { PrismaService } from '../../../common/prisma/prisma.service.js';

const date = (iso: string | null | undefined): Date | null | undefined => (iso === undefined ? undefined : iso ? isoToDate(iso) : null);
const dec = (v: string | null | undefined): Prisma.Decimal | null | undefined => (v === undefined ? undefined : v ? new Prisma.Decimal(v) : null);

@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(filter: { entityId?: string; status?: string; expiringDays?: number; q?: string }) {
    const where: Prisma.ContractWhereInput = { deletedAt: null, entityId: filter.entityId };
    if (filter.status) where.status = filter.status as Prisma.ContractWhereInput['status'];
    if (filter.q) where.OR = [{ number: { contains: filter.q, mode: 'insensitive' } }, { object: { contains: filter.q, mode: 'insensitive' } }, { entity: { name: { contains: filter.q, mode: 'insensitive' } } }];
    if (filter.expiringDays !== undefined) {
      where.status = 'ACTIVE';
      where.endDate = { lte: new Date(Date.now() + filter.expiringDays * 86_400_000), gte: new Date() };
    }
    return this.prisma.contract.findMany({
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

  async get(id: string) {
    const c = await this.prisma.contract.findFirst({
      where: { id, deletedAt: null },
      include: {
        entity: true,
        amendments: { orderBy: { sequence: 'asc' }, include: { document: { select: { id: true, name: true } } } },
        documents: { where: { deletedAt: null }, orderBy: { capturedAt: 'desc' } },
        responsibleUser: { select: { id: true, name: true } },
      },
    });
    if (!c) throw new NotFoundException('Contrato não encontrado');
    return c;
  }

  async create(ctx: RequestContext, input: z.infer<typeof createContractSchema>) {
    const c = await this.prisma.contract.create({
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
    await this.audit.log(ctx, { action: 'CREATE', resource: 'contract', resourceId: c.id, after: c });
    return c;
  }

  async update(ctx: RequestContext, id: string, input: z.infer<typeof updateContractSchema>) {
    const before = await this.get(id);
    const c = await this.prisma.contract.update({
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
    await this.audit.log(ctx, { action: 'UPDATE', resource: 'contract', resourceId: id, before: { ...before, entity: undefined, amendments: undefined, documents: undefined }, after: c });
    return c;
  }

  async softDelete(ctx: RequestContext, id: string): Promise<void> {
    const before = await this.get(id);
    await this.prisma.contract.update({ where: { id }, data: { deletedAt: new Date(), status: 'TERMINATED' } });
    await this.audit.log(ctx, { action: 'SOFT_DELETE', resource: 'contract', resourceId: id, before: { number: before.number, entityId: before.entityId } });
  }

  async addAmendment(ctx: RequestContext, contractId: string, input: z.infer<typeof createAmendmentSchema>) {
    const contract = await this.get(contractId);
    const sequence = input.sequence ?? (contract.amendments.at(-1)?.sequence ?? 0) + 1;
    const a = await this.prisma.$transaction(async (tx) => {
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
    await this.audit.log(ctx, { action: 'AMENDMENT_ADDED', resource: 'contract', resourceId: contractId, after: a });
    return a;
  }

  async removeAmendment(ctx: RequestContext, contractId: string, amendmentId: string): Promise<void> {
    const a = await this.prisma.contractAmendment.findFirst({ where: { id: amendmentId, contractId } });
    if (!a) throw new NotFoundException('Aditivo não encontrado');
    await this.prisma.contractAmendment.delete({ where: { id: amendmentId } });
    await this.audit.log(ctx, { action: 'AMENDMENT_REMOVED', resource: 'contract', resourceId: contractId, before: a });
  }
}
