import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, ServiceOrderStatus } from '@siow/db';
import { isoToDate } from '@siow/shared';
import type { z } from 'zod';
import type { createServiceOrderSchema, registerManualSignatureSchema, updateServiceOrderSchema } from '@siow/shared';
import { AuditService } from '../../../common/audit/audit.service.js';
import type { RequestContext } from '../../../common/auth/decorators.js';
import { PrismaService } from '../../../common/prisma/prisma.service.js';
import { getConfiguredSignatureProvider } from './signature/signature.provider.js';

const include = {
  entity: { select: { id: true, name: true, shortName: true } },
  contract: { select: { id: true, number: true } },
  invoice: { select: { id: true, number: true, status: true } },
  document: { select: { id: true, name: true } },
  signedDocument: { select: { id: true, name: true, blob: { select: { checksum: true } } } },
  signatories: true,
  signatureRequests: { orderBy: { createdAt: 'desc' as const } },
} satisfies Prisma.ServiceOrderInclude;

@Injectable()
export class ServiceOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(filter: { entityId?: string; contractId?: string; status?: ServiceOrderStatus; year?: number }) {
    return this.prisma.serviceOrder.findMany({
      where: { deletedAt: null, entityId: filter.entityId, contractId: filter.contractId, status: filter.status, competenceYear: filter.year },
      include,
      orderBy: [{ competenceYear: 'desc' }, { competenceMonth: 'desc' }],
    });
  }

  async get(id: string) {
    const so = await this.prisma.serviceOrder.findFirst({ where: { id, deletedAt: null }, include: { ...include, events: { orderBy: { createdAt: 'desc' }, include: { user: { select: { id: true, name: true } } } } } });
    if (!so) throw new NotFoundException('Ordem de serviço não encontrada');
    return so;
  }

  async create(ctx: RequestContext, input: z.infer<typeof createServiceOrderSchema>) {
    const so = await this.prisma.serviceOrder.create({
      data: {
        entityId: input.entityId,
        contractId: input.contractId,
        invoiceId: input.invoiceId ?? null,
        competenceMonth: input.competenceMonth,
        competenceYear: input.competenceYear,
        number: input.number ?? null,
        status: input.status ?? 'NOT_REQUESTED',
        requestedAt: input.requestedAt ? isoToDate(input.requestedAt) : null,
        issuedAt: input.issuedAt ? isoToDate(input.issuedAt) : null,
        notes: input.notes ?? null,
        events: { create: { action: 'CREATED', userId: ctx.user.id, toValue: input.status ?? 'NOT_REQUESTED' } },
      },
      include,
    });
    await this.audit.log(ctx, { action: 'CREATE', resource: 'serviceOrder', resourceId: so.id, after: so });
    return so;
  }

  async update(ctx: RequestContext, id: string, input: z.infer<typeof updateServiceOrderSchema>) {
    const before = await this.get(id);
    const events: Prisma.ServiceOrderEventCreateWithoutServiceOrderInput[] = [];
    if (input.status && input.status !== before.status) events.push({ action: 'STATUS_CHANGED', user: { connect: { id: ctx.user.id } }, fromValue: before.status, toValue: input.status, note: input.note });
    else if (input.note) events.push({ action: 'COMMENT', user: { connect: { id: ctx.user.id } }, note: input.note });
    const { note: _n, ...rest } = input;
    const so = await this.prisma.serviceOrder.update({
      where: { id },
      data: {
        ...rest,
        requestedAt: rest.requestedAt === undefined ? undefined : rest.requestedAt ? isoToDate(rest.requestedAt) : null,
        issuedAt: rest.issuedAt === undefined ? undefined : rest.issuedAt ? isoToDate(rest.issuedAt) : null,
        events: events.length ? { create: events } : undefined,
      },
      include,
    });
    await this.audit.log(ctx, { action: 'UPDATE', resource: 'serviceOrder', resourceId: id, before: { status: before.status, number: before.number }, after: { status: so.status, number: so.number } });
    return so;
  }

  /** Vincula o PDF da OS emitida. */
  async attachDocument(ctx: RequestContext, id: string, documentId: string) {
    await this.get(id);
    const so = await this.prisma.serviceOrder.update({
      where: { id },
      data: { documentId, status: 'ISSUED', issuedAt: new Date(), events: { create: { action: 'DOCUMENT_ATTACHED', userId: ctx.user.id, toValue: documentId } } },
      include,
    });
    await this.audit.log(ctx, { action: 'SERVICE_ORDER_DOCUMENT', resource: 'serviceOrder', resourceId: id, after: { documentId } });
    return so;
  }

  /**
   * Registro de assinatura no MVP (sem provedor): upload da OS assinada,
   * signatários, data, usuário e checksum — tudo auditado.
   */
  async registerManualSignature(ctx: RequestContext, id: string, input: z.infer<typeof registerManualSignatureSchema>) {
    const so = await this.get(id);
    if (so.status === 'CANCELLED') throw new BadRequestException('OS cancelada');
    const doc = await this.prisma.document.findFirst({ where: { id: input.signedDocumentId, deletedAt: null }, include: { blob: true } });
    if (!doc) throw new NotFoundException('Documento assinado não encontrado');
    const signedAt = isoToDate(input.signedAt);
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.document.update({ where: { id: doc.id }, data: { type: 'SERVICE_ORDER_SIGNED', serviceOrderId: id, entityId: so.entityId, contractId: so.contractId } });
      await tx.serviceOrderSignatory.createMany({ data: input.signatories.map((s) => ({ serviceOrderId: id, name: s.name, role: s.role ?? null, email: s.email ?? null, signedAt })) });
      await tx.signatureRequest.create({
        data: {
          serviceOrderId: id,
          provider: 'MANUAL_UPLOAD',
          status: 'COMPLETED_MANUALLY',
          completedAt: new Date(),
          signedDocumentId: doc.id,
          registeredByUserId: ctx.user.id,
          evidence: { checksum: doc.blob.checksum, size: doc.blob.size, signedAt: input.signedAt, signatories: input.signatories, note: input.note ?? null },
        },
      });
      return tx.serviceOrder.update({
        where: { id },
        data: { status: 'SIGNED', signedAt, signedDocumentId: doc.id, events: { create: { action: 'SIGNED_MANUALLY', userId: ctx.user.id, fromValue: so.status, toValue: 'SIGNED', note: input.note } } },
        include,
      });
    });
    await this.audit.log(ctx, { action: 'SERVICE_ORDER_SIGNED', resource: 'serviceOrder', resourceId: id, after: { signedDocumentId: doc.id, checksum: doc.blob.checksum, signatories: input.signatories } });
    return updated;
  }

  /** Informa ao frontend se há provedor de assinatura eletrônica configurado. */
  signatureCapabilities() {
    const p = getConfiguredSignatureProvider();
    return { provider: p?.key ?? null, electronicSignatureAvailable: Boolean(p), manualUploadAvailable: true };
  }
}
