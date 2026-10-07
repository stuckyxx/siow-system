import { createHash } from 'node:crypto';
import type { DocumentType, Prisma, PrismaClient, RecordOrigin } from '@siow/db';
import type { ObjectStorage } from './object-storage.js';

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

const EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/csv': 'csv',
};

/**
 * Persistência de documentos com deduplicação por checksum SHA-256:
 * o mesmo arquivo referenciado por várias notas/entidades ocupa um único
 * objeto no bucket (DocumentBlob) — cada vínculo é um Document.
 */
export class DocumentStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: ObjectStorage,
  ) {}

  static checksum(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  async store(input: StoreDocumentInput): Promise<{ documentId: string; blobId: string; deduplicated: boolean }> {
    const checksum = DocumentStore.checksum(input.buffer);
    let blob = await this.prisma.documentBlob.findUnique({ where: { checksum } });
    let deduplicated = true;
    if (!blob) {
      deduplicated = false;
      const ext = EXT[input.mimeType] ?? 'bin';
      const key = `documents/${checksum.slice(0, 2)}/${checksum.slice(2, 4)}/${checksum}.${ext}`;
      await this.storage.put(key, input.buffer, input.mimeType);
      blob = await this.prisma.documentBlob.create({
        data: { checksum, storageKey: key, size: input.buffer.length, mimeType: input.mimeType },
      });
    }
    const doc = await this.prisma.document.create({
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

  async presignedUrl(documentId: string): Promise<{ url: string; name: string; mimeType: string; size: number }> {
    const doc = await this.prisma.document.findUniqueOrThrow({ where: { id: documentId }, include: { blob: true } });
    const url = await this.storage.presignDownload(doc.blob.storageKey, doc.name);
    return { url, name: doc.name, mimeType: doc.blob.mimeType, size: doc.blob.size };
  }
}
