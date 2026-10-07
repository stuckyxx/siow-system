/**
 * Documentos: upload com deduplicação por SHA-256 (DocumentBlob compartilhado),
 * listagem, download e exclusão lógica. Conteúdo físico no Vercel Blob.
 */
import { createHash } from 'node:crypto';
import type { DocumentType, Prisma, RecordOrigin } from '@siow/db';
import { isoToDate } from '@siow/shared';
import { prisma } from '../db.js';
import { audit } from '../audit.js';
import { badRequest, notFound, type Ctx } from '../http.js';
import { blobKey, getBlobUrl, putBlob } from '../storage.js';

export const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
export const MAX_SIZE = 25 * 1024 * 1024;

const EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/csv': 'csv',
};

export interface UploadMeta {
  type: DocumentType;
  entityId?: string;
  contractId?: string;
  invoiceId?: string;
  serviceOrderId?: string;
  sourceDate?: string;
  name?: string;
}

export interface StoreDocumentInput {
  buffer: Buffer;
  mimeType: string;
  name: string;
  type: DocumentType;
  entityId?: string | null;
  contractId?: string | null;
  invoiceId?: string | null;
  serviceOrderId?: string | null;
  originalUrl?: string | null;
  sourceDate?: Date | null;
  uploadedByUserId?: string | null;
  origin?: RecordOrigin;
  metadata?: Prisma.InputJsonValue;
}

export const checksum = (buffer: Buffer): string => createHash('sha256').update(buffer).digest('hex');

/**
 * Persiste um documento. O mesmo conteúdo (checksum) referenciado por várias
 * notas/entidades ocupa um único blob — cada vínculo é um Document.
 * Reutilizável por outros módulos (sync, geração de PDF, etc.).
 */
export async function storeDocument(input: StoreDocumentInput): Promise<{ documentId: string; blobId: string; deduplicated: boolean }> {
  const sum = checksum(input.buffer);
  let blob = await prisma.documentBlob.findUnique({ where: { checksum: sum } });
  let deduplicated = true;
  if (!blob) {
    deduplicated = false;
    const ext = EXT[input.mimeType] ?? 'bin';
    const { url } = await putBlob(blobKey(`documents/${sum.slice(0, 2)}`, sum, ext), input.buffer, input.mimeType);
    blob = await prisma.documentBlob.create({ data: { checksum: sum, storageKey: url, size: input.buffer.length, mimeType: input.mimeType } });
  }
  const doc = await prisma.document.create({
    data: {
      type: input.type,
      name: input.name,
      blobId: blob.id,
      entityId: input.entityId ?? null,
      contractId: input.contractId ?? null,
      invoiceId: input.invoiceId ?? null,
      serviceOrderId: input.serviceOrderId ?? null,
      originalUrl: input.originalUrl ?? null,
      sourceDate: input.sourceDate ?? null,
      uploadedByUserId: input.uploadedByUserId ?? null,
      origin: input.origin ?? 'MANUAL',
      metadata: input.metadata,
    },
  });
  return { documentId: doc.id, blobId: blob.id, deduplicated };
}

export async function upload(ctx: Ctx, file: File, meta: UploadMeta) {
  const mimeType = file.type || 'application/octet-stream';
  if (!ALLOWED_MIME.has(mimeType)) throw badRequest('Tipo de arquivo não permitido');
  if (file.size > MAX_SIZE) throw badRequest('Arquivo excede 25 MB');
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length === 0) throw badRequest('Arquivo vazio');
  const result = await storeDocument({
    buffer,
    mimeType,
    name: meta.name ?? file.name,
    type: meta.type,
    entityId: meta.entityId ?? null,
    contractId: meta.contractId ?? null,
    invoiceId: meta.invoiceId ?? null,
    serviceOrderId: meta.serviceOrderId ?? null,
    sourceDate: meta.sourceDate ? isoToDate(meta.sourceDate) : null,
    uploadedByUserId: ctx.user.id,
    origin: 'MANUAL',
  });
  await audit(ctx, { action: 'DOCUMENT_UPLOADED', resource: 'document', resourceId: result.documentId, after: { ...meta, size: buffer.length, deduplicated: result.deduplicated } });
  return get(result.documentId);
}

export async function get(id: string) {
  const doc = await prisma.document.findFirst({
    where: { id, deletedAt: null },
    include: { blob: { select: { size: true, mimeType: true, checksum: true } }, uploadedBy: { select: { id: true, name: true } } },
  });
  if (!doc) throw notFound('Documento não encontrado');
  return doc;
}

export async function list(filter: { entityId?: string; contractId?: string; invoiceId?: string; serviceOrderId?: string; type?: DocumentType }) {
  return prisma.document.findMany({
    where: { deletedAt: null, ...filter },
    include: { blob: { select: { size: true, mimeType: true } } },
    orderBy: { capturedAt: 'desc' },
  });
}

/** URL de download (blob com chave não adivinhável). Mesmo formato do presigned do S3. */
export async function downloadUrl(ctx: Ctx, id: string): Promise<{ url: string; name: string; mimeType: string; size: number }> {
  const doc = await prisma.document.findFirst({ where: { id, deletedAt: null }, include: { blob: true } });
  if (!doc) throw notFound('Documento não encontrado');
  await audit(ctx, { action: 'DOCUMENT_DOWNLOAD', resource: 'document', resourceId: id });
  return { url: getBlobUrl(doc.blob.storageKey, doc.id), name: doc.name, mimeType: doc.blob.mimeType, size: doc.blob.size };
}

export async function softDelete(ctx: Ctx, id: string): Promise<void> {
  const before = await get(id);
  await prisma.document.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit(ctx, { action: 'SOFT_DELETE', resource: 'document', resourceId: id, before: { name: before.name, type: before.type } });
}
