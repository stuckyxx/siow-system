/**
 * Ordens de serviço (spec §20–21): ciclo solicitação → emissão → assinatura,
 * com registro manual de assinatura (upload da OS assinada) e eventos.
 */
import type { Prisma, ServiceOrderStatus } from '@siow/db';
import { isoToDate } from '@siow/shared';
import type { z } from 'zod';
import type { createServiceOrderSchema, registerManualSignatureSchema, updateServiceOrderSchema } from '@siow/shared';
import { prisma } from '../db.js';
import { audit } from '../audit.js';
import { badRequest, notFound, type Ctx } from '../http.js';
import { getConfiguredSignatureProvider } from './signature.js';

const include = {
  entity: { select: { id: true, name: true, shortName: true } },
  contract: { select: { id: true, number: true } },
  invoice: { select: { id: true, number: true, status: true } },
  document: { select: { id: true, name: true } },
  signedDocument: { select: { id: true, name: true, blob: { select: { checksum: true } } } },
  signatories: true,
  signatureRequests: { orderBy: { createdAt: 'desc' as const } },
} satisfies Prisma.ServiceOrderInclude;

export async function list(filter: { entityId?: string; contractId?: string; status?: ServiceOrderStatus; year?: number }) {
  return prisma.serviceOrder.findMany({
    where: { deletedAt: null, entityId: filter.entityId, contractId: filter.contractId, status: filter.status, competenceYear: filter.year },
    include,
    orderBy: [{ competenceYear: 'desc' }, { competenceMonth: 'desc' }],
  });
}

export async function get(id: string) {
  const so = await prisma.serviceOrder.findFirst({ where: { id, deletedAt: null }, include: { ...include, events: { orderBy: { createdAt: 'desc' }, include: { user: { select: { id: true, name: true } } } } } });
  if (!so) throw notFound('Ordem de serviço não encontrada');
  return so;
}

export async function create(ctx: Ctx, input: z.infer<typeof createServiceOrderSchema>) {
  const so = await prisma.serviceOrder.create({
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
  await audit(ctx, { action: 'CREATE', resource: 'serviceOrder', resourceId: so.id, after: so });
  return so;
}

export async function update(ctx: Ctx, id: string, input: z.infer<typeof updateServiceOrderSchema>) {
  const before = await get(id);
  const events: Prisma.ServiceOrderEventCreateWithoutServiceOrderInput[] = [];
  if (input.status && input.status !== before.status) events.push({ action: 'STATUS_CHANGED', user: { connect: { id: ctx.user.id } }, fromValue: before.status, toValue: input.status, note: input.note });
  else if (input.note) events.push({ action: 'COMMENT', user: { connect: { id: ctx.user.id } }, note: input.note });
  const { note: _n, ...rest } = input;
  const so = await prisma.serviceOrder.update({
    where: { id },
    data: {
      ...rest,
      requestedAt: rest.requestedAt === undefined ? undefined : rest.requestedAt ? isoToDate(rest.requestedAt) : null,
      issuedAt: rest.issuedAt === undefined ? undefined : rest.issuedAt ? isoToDate(rest.issuedAt) : null,
      events: events.length ? { create: events } : undefined,
    },
    include,
  });
  await audit(ctx, { action: 'UPDATE', resource: 'serviceOrder', resourceId: id, before: { status: before.status, number: before.number }, after: { status: so.status, number: so.number } });
  return so;
}

/** Vincula o PDF da OS emitida. */
export async function attachDocument(ctx: Ctx, id: string, documentId: string) {
  await get(id);
  const so = await prisma.serviceOrder.update({
    where: { id },
    data: { documentId, status: 'ISSUED', issuedAt: new Date(), events: { create: { action: 'DOCUMENT_ATTACHED', userId: ctx.user.id, toValue: documentId } } },
    include,
  });
  await audit(ctx, { action: 'SERVICE_ORDER_DOCUMENT', resource: 'serviceOrder', resourceId: id, after: { documentId } });
  return so;
}

/**
 * Registro de assinatura no MVP (sem provedor): upload da OS assinada,
 * signatários, data, usuário e checksum — tudo auditado.
 */
export async function registerManualSignature(ctx: Ctx, id: string, input: z.infer<typeof registerManualSignatureSchema>) {
  const so = await get(id);
  if (so.status === 'CANCELLED') throw badRequest('OS cancelada');
  const doc = await prisma.document.findFirst({ where: { id: input.signedDocumentId, deletedAt: null }, include: { blob: true } });
  if (!doc) throw notFound('Documento assinado não encontrado');
  const signedAt = isoToDate(input.signedAt);
  const updated = await prisma.$transaction(async (tx) => {
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
  await audit(ctx, { action: 'SERVICE_ORDER_SIGNED', resource: 'serviceOrder', resourceId: id, after: { signedDocumentId: doc.id, checksum: doc.blob.checksum, signatories: input.signatories } });
  return updated;
}

/** Informa ao frontend se há provedor de assinatura eletrônica configurado. */
export function signatureCapabilities() {
  const p = getConfiguredSignatureProvider();
  return { provider: p?.key ?? null, electronicSignatureAvailable: Boolean(p), manualUploadAvailable: true };
}
