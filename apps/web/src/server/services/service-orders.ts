/**
 * Ordens de serviço (spec §20–21): ciclo solicitação → emissão → assinatura,
 * com registro manual de assinatura (upload da OS assinada) e eventos.
 */
import type { Prisma, ServiceOrderStatus } from '@siow/db';
import { isoToDate } from '@siow/shared';
import type { z } from 'zod';
import type { createServiceOrderSchema, registerManualSignatureSchema, updateServiceOrderSchema } from '@siow/shared';
import { prisma } from '../db.js';
import { currentOrgId } from '../tenant.js';
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
      organizationId: currentOrgId(),
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
        organizationId: currentOrgId(),
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
export async function signatureCapabilities() {
  const p = await getConfiguredSignatureProvider();
  return { provider: p?.key ?? null, electronicSignatureAvailable: Boolean(p), manualUploadAvailable: true };
}

/** Envia a OS (documento anexado) para assinatura eletrônica no provedor configurado. Idempotente: uma solicitação ativa por OS. */
export async function sendForSignature(ctx: Ctx, id: string, input: { signers: Array<{ name: string; email: string; role?: string | null }>; deadlineDays?: number | null }) {
  const so = await get(id);
  if (so.status === 'CANCELLED' || so.status === 'SIGNED') throw badRequest('OS já assinada ou cancelada');
  if (!so.document) throw badRequest('Anexe o documento da OS antes de enviar para assinatura');
  const provider = await getConfiguredSignatureProvider();
  if (!provider) throw badRequest('Nenhum provedor de assinatura eletrônica configurado (Administração → Integrações)');
  const active = so.signatureRequests.find((r) => ['SENT', 'VIEWED'].includes(r.status));
  if (active) return { request: active, reused: true };
  const doc = await prisma.document.findFirst({ where: { id: so.document.id, deletedAt: null }, include: { blob: true } });
  if (!doc) throw notFound('Documento da OS não encontrado');
  const { fetchBlob } = await import('../storage.js');
  const buffer = Buffer.from(await (await fetchBlob(doc.blob.storageKey)).arrayBuffer());
  const r = await provider.createRequest({ documentBuffer: buffer, fileName: doc.name.toLowerCase().endsWith('.pdf') ? doc.name : `${doc.name}.pdf`, signers: input.signers.map((s) => ({ name: s.name, email: s.email, role: s.role ?? undefined })), deadlineDays: input.deadlineDays ?? undefined });
  const req = await prisma.signatureRequest.create({ data: { organizationId: currentOrgId(), serviceOrderId: id, provider: provider.key, providerRequestId: r.providerRequestId, status: 'SENT', sentAt: new Date(), registeredByUserId: ctx.user.id, evidence: { signers: input.signers } } });
  await prisma.serviceOrderSignatory.createMany({ data: input.signers.map((s) => ({ serviceOrderId: id, name: s.name, role: s.role ?? null, email: s.email })) });
  await prisma.serviceOrder.update({ where: { id }, data: { status: 'AWAITING_SIGNATURE', events: { create: { action: 'SENT_FOR_SIGNATURE', userId: ctx.user.id, fromValue: so.status, toValue: 'AWAITING_SIGNATURE', note: `${provider.key} · ${r.providerRequestId}` } } } });
  await audit(ctx, { action: 'SERVICE_ORDER_SENT_FOR_SIGNATURE', resource: 'serviceOrder', resourceId: id, after: { provider: provider.key, providerRequestId: r.providerRequestId, signers: input.signers.map((x) => x.name) } });
  return { request: req, reused: false };
}

/** Aplica um status vindo do provedor (webhook ou consulta): SIGNED baixa o documento assinado e conclui a OS. Idempotente. */
export async function applySignatureUpdate(providerRequestId: string, status: 'SENT' | 'VIEWED' | 'SIGNED' | 'DECLINED' | 'EXPIRED' | 'CANCELLED', evidence?: unknown): Promise<{ applied: boolean; serviceOrderId: string | null }> {
  const req = await prisma.signatureRequest.findFirst({ where: { providerRequestId }, include: { serviceOrder: { select: { id: true, entityId: true, contractId: true, status: true, number: true } } } });
  if (!req) return { applied: false, serviceOrderId: null };
  if (req.status === 'SIGNED' || req.status === 'COMPLETED_MANUALLY') return { applied: false, serviceOrderId: req.serviceOrderId };
  if (status === 'SIGNED') {
    const provider = await (await import('./signature.js')).providerByKey(req.provider);
    let signedDocumentId: string | null = null;
    if (provider) {
      try {
        const file = await provider.downloadSigned(providerRequestId);
        const { storeDocument } = await import('./documents.js');
        const r = await storeDocument({ buffer: file.buffer, mimeType: file.mimeType, name: `OS ${req.serviceOrder.number ?? ''} assinada.pdf`.replace(/\s+/g, ' '), type: 'SERVICE_ORDER_SIGNED', entityId: req.serviceOrder.entityId, contractId: req.serviceOrder.contractId, serviceOrderId: req.serviceOrderId, origin: 'SYNC' });
        signedDocumentId = r.documentId;
      } catch (e) { console.error('download do documento assinado falhou', e); }
    }
    await prisma.$transaction(async (tx) => {
      await tx.signatureRequest.update({ where: { id: req.id }, data: { status: 'SIGNED', completedAt: new Date(), signedDocumentId, evidence: (evidence ?? req.evidence ?? {}) as Prisma.InputJsonValue } });
      await tx.serviceOrderSignatory.updateMany({ where: { serviceOrderId: req.serviceOrderId, signedAt: null }, data: { signedAt: new Date() } });
      await tx.serviceOrder.update({ where: { id: req.serviceOrderId }, data: { status: 'SIGNED', signedAt: new Date(), signedDocumentId: signedDocumentId ?? undefined, events: { create: { action: 'SIGNED_ELECTRONICALLY', fromValue: req.serviceOrder.status, toValue: 'SIGNED', note: `${req.provider} · ${providerRequestId}` } } } });
    });
    await audit(null, { action: 'SERVICE_ORDER_SIGNED', resource: 'serviceOrder', resourceId: req.serviceOrderId, after: { provider: req.provider, providerRequestId, signedDocumentId } });
    return { applied: true, serviceOrderId: req.serviceOrderId };
  }
  if (status !== req.status) {
    await prisma.signatureRequest.update({ where: { id: req.id }, data: { status, evidence: (evidence ?? req.evidence ?? {}) as Prisma.InputJsonValue, completedAt: ['DECLINED', 'EXPIRED', 'CANCELLED'].includes(status) ? new Date() : null } });
    if (['DECLINED', 'EXPIRED', 'CANCELLED'].includes(status)) await prisma.serviceOrder.update({ where: { id: req.serviceOrderId }, data: { status: 'ISSUED', events: { create: { action: `SIGNATURE_${status}`, fromValue: 'AWAITING_SIGNATURE', toValue: 'ISSUED', note: providerRequestId } } } });
  }
  return { applied: true, serviceOrderId: req.serviceOrderId };
}

/** Consulta ativa dos pedidos em aberto (complementa o webhook). */
export async function pollSignatures(): Promise<{ checked: number; updated: number }> {
  const open = await prisma.signatureRequest.findMany({ where: { status: { in: ['SENT', 'VIEWED'] }, providerRequestId: { not: null } }, take: 50 });
  let updated = 0;
  for (const r of open) {
    const provider = await (await import('./signature.js')).providerByKey(r.provider); if (!provider) continue;
    try { const s = await provider.getStatus(r.providerRequestId!); if (s.status !== r.status) { const a = await applySignatureUpdate(r.providerRequestId!, s.status, s.evidence); if (a.applied) updated += 1; } } catch (e) { console.error('poll assinatura falhou', r.id, e); }
  }
  return { checked: open.length, updated };
}
