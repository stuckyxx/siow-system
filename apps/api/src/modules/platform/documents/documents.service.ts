import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { DocumentType } from '@siow/db';
import type { DocumentStore } from '@siow/storage';
import { isoToDate } from '@siow/shared';
import { AuditService } from '../../../common/audit/audit.service.js';
import type { RequestContext } from '../../../common/auth/decorators.js';
import { DOCUMENT_STORE_TOKEN } from '../../../common/infra/infra.module.js';
import { PrismaService } from '../../../common/prisma/prisma.service.js';

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const MAX_SIZE = 25 * 1024 * 1024;

export interface UploadMeta {
  type: DocumentType;
  entityId?: string;
  contractId?: string;
  invoiceId?: string;
  serviceOrderId?: string;
  sourceDate?: string;
  name?: string;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(DOCUMENT_STORE_TOKEN) private readonly store: DocumentStore,
  ) {}

  async upload(ctx: RequestContext, file: { buffer: Buffer; mimetype: string; originalname: string; size: number }, meta: UploadMeta) {
    if (!ALLOWED_MIME.has(file.mimetype)) throw new BadRequestException('Tipo de arquivo não permitido');
    if (file.size > MAX_SIZE) throw new BadRequestException('Arquivo excede 25 MB');
    const result = await this.store.store({
      buffer: file.buffer,
      mimeType: file.mimetype,
      name: meta.name ?? file.originalname,
      type: meta.type,
      entityId: meta.entityId ?? null,
      contractId: meta.contractId ?? null,
      invoiceId: meta.invoiceId ?? null,
      serviceOrderId: meta.serviceOrderId ?? null,
      sourceDate: meta.sourceDate ? isoToDate(meta.sourceDate) : null,
      uploadedByUserId: ctx.user.id,
      origin: 'MANUAL',
    });
    await this.audit.log(ctx, { action: 'DOCUMENT_UPLOADED', resource: 'document', resourceId: result.documentId, after: { ...meta, size: file.size, deduplicated: result.deduplicated } });
    return this.get(result.documentId);
  }

  async get(id: string) {
    const doc = await this.prisma.document.findFirst({ where: { id, deletedAt: null }, include: { blob: { select: { size: true, mimeType: true, checksum: true } }, uploadedBy: { select: { id: true, name: true } } } });
    if (!doc) throw new NotFoundException('Documento não encontrado');
    return doc;
  }

  async list(filter: { entityId?: string; contractId?: string; invoiceId?: string; serviceOrderId?: string; type?: DocumentType }) {
    return this.prisma.document.findMany({
      where: { deletedAt: null, ...filter },
      include: { blob: { select: { size: true, mimeType: true } } },
      orderBy: { capturedAt: 'desc' },
    });
  }

  /** URL temporária (presigned) — o bucket é privado; nada é público. */
  async downloadUrl(ctx: RequestContext, id: string) {
    await this.get(id);
    const signed = await this.store.presignedUrl(id);
    await this.audit.log(ctx, { action: 'DOCUMENT_DOWNLOAD', resource: 'document', resourceId: id });
    return signed;
  }

  async softDelete(ctx: RequestContext, id: string): Promise<void> {
    const before = await this.get(id);
    await this.prisma.document.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log(ctx, { action: 'SOFT_DELETE', resource: 'document', resourceId: id, before: { name: before.name, type: before.type } });
  }
}
