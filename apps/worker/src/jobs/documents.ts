import type { Job } from 'bullmq';
import { getProvider, type DocumentRef } from '@siow/integrations';
import type { DocumentJobData } from '@siow/queue';
import type { WorkerContext } from '../context.js';

const providerCtx = (): { timeoutMs: number; userAgent: string } => ({
  timeoutMs: Number(process.env['SYNC_HTTP_TIMEOUT_MS'] ?? 20_000),
  userAgent: process.env['SYNC_USER_AGENT'] ?? 'SiowSystem/1.0',
});

/**
 * Captura de documentos para o bucket privado.
 *  - certidões e recibos: GET sem efeitos colaterais → automático
 *  - nota fiscal (ver_nota.php): POST que incrementa contador no portal →
 *    apenas sob demanda de um usuário (INVOICE_DOCUMENT)
 */
export async function runFetchDocument(ctx: WorkerContext, job: Job<DocumentJobData>): Promise<void> {
  const data = job.data;
  if (data.kind === 'CERTIFICATE_VERSION') {
    const v = await ctx.prisma.certificateVersion.findUnique({ where: { id: data.certificateVersionId }, include: { certificate: true } });
    if (!v || v.documentId || !v.sourceUrl) return;
    const provider = getProvider('ASSESI_PORTAL');
    const file = await provider.fetchDocument({ kind: 'CERTIFICATE', url: v.sourceUrl, method: 'GET' }, providerCtx());
    const { documentId } = await ctx.documents.store({
      buffer: file.buffer,
      mimeType: file.mimeType,
      name: `${v.certificate.name}${v.validUntil ? ` - válida até ${v.validUntil.toISOString().slice(0, 10)}` : ''}.pdf`,
      type: 'CERTIFICATE',
      originalUrl: v.sourceUrl,
      sourceDate: v.issuedAt,
      origin: 'SYNC',
    });
    await ctx.prisma.certificateVersion.update({ where: { id: v.id }, data: { documentId } });
    return;
  }

  const invoice = await ctx.prisma.invoice.findUnique({ where: { id: data.invoiceId }, include: { entity: true, dataSource: true } });
  if (!invoice) return;
  const provider = getProvider(invoice.dataSource?.provider ?? 'ASSESI_PORTAL');

  if (data.kind === 'INVOICE_RECEIPT') {
    if (!invoice.receiptUrl) return;
    const already = await ctx.prisma.document.findFirst({ where: { invoiceId: invoice.id, type: 'RECEIPT', deletedAt: null } });
    if (already) return;
    const file = await provider.fetchDocument({ kind: 'RECEIPT', url: invoice.receiptUrl, method: 'GET' }, providerCtx());
    await ctx.documents.store({
      buffer: file.buffer,
      mimeType: file.mimeType,
      name: `Recibo NF ${invoice.number}.pdf`,
      type: 'RECEIPT',
      entityId: invoice.entityId,
      contractId: invoice.contractId,
      invoiceId: invoice.id,
      originalUrl: invoice.receiptUrl,
      sourceDate: invoice.paidAt,
      origin: 'SYNC',
    });
    return;
  }

  if (data.kind === 'INVOICE_DOCUMENT') {
    if (!invoice.documentUrl) throw new Error('Nota sem URL de documento na origem');
    const ref: DocumentRef = {
      kind: 'INVOICE',
      url: invoice.documentUrl,
      method: 'POST',
      form: invoice.externalId ? { idNota: invoice.externalId } : {},
      sideEffects: true,
    };
    const file = await provider.fetchDocument(ref, providerCtx());
    await ctx.documents.store({
      buffer: file.buffer,
      mimeType: file.mimeType,
      name: `NF ${invoice.number} - ${invoice.entity.shortName ?? invoice.entity.name}.pdf`,
      type: 'INVOICE',
      entityId: invoice.entityId,
      contractId: invoice.contractId,
      invoiceId: invoice.id,
      originalUrl: invoice.documentUrl,
      sourceDate: invoice.issueDate,
      uploadedByUserId: data.requestedByUserId,
      origin: 'SYNC',
    });
    await ctx.prisma.auditLog.create({
      data: {
        userId: data.requestedByUserId,
        action: 'DOCUMENT_CAPTURED',
        resource: 'invoice',
        resourceId: invoice.id,
        after: { type: 'INVOICE', originalUrl: invoice.documentUrl },
      },
    });
  }
}
