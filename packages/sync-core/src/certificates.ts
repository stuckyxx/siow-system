import { Prisma, type PrismaClient } from '@siow/db';
import type { CertificateSnapshot } from '@siow/integrations';
import { isoToDate } from '@siow/shared';

type Tx = Prisma.TransactionClient | PrismaClient;

export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

export interface CertificateSyncResult {
  created: number;
  newVersions: number;
  unchanged: number;
  /** versões novas que ainda precisam ter o PDF baixado */
  versionIdsToFetch: string[];
}

/**
 * Certidões do portal são da própria empresa (entityId = null): a mesma lista
 * aparece em todas as entidades. Cada mudança de arquivo/validade gera uma
 * nova CertificateVersion; as anteriores ficam como histórico (isCurrent=false).
 */
export async function syncCertificates(tx: Tx, items: CertificateSnapshot[]): Promise<CertificateSyncResult> {
  const result: CertificateSyncResult = { created: 0, newVersions: 0, unchanged: 0, versionIdsToFetch: [] };

  for (const item of items) {
    const slug = slugify(item.name);
    if (!slug) continue;
    let cert = await tx.certificate.findFirst({ where: { slug, entityId: null } });
    if (!cert) {
      cert = await tx.certificate.create({ data: { slug, name: item.name } });
      result.created += 1;
    }
    const current = await tx.certificateVersion.findFirst({
      where: { certificateId: cert.id, isCurrent: true },
      orderBy: { capturedAt: 'desc' },
    });
    const validUntil = item.validUntil ? isoToDate(item.validUntil) : null;
    const sameFile = current?.externalId && item.externalId ? current.externalId === item.externalId : current?.sourceUrl === item.url;
    const sameValidity = (current?.validUntil?.getTime() ?? null) === (validUntil?.getTime() ?? null);

    if (current && sameFile && sameValidity) {
      result.unchanged += 1;
      continue;
    }
    if (current) {
      await tx.certificateVersion.updateMany({ where: { certificateId: cert.id, isCurrent: true }, data: { isCurrent: false } });
    }
    const version = await tx.certificateVersion.create({
      data: {
        certificateId: cert.id,
        externalId: item.externalId,
        sourceUrl: item.url,
        validUntil,
        issuedAt: item.issuedAt ? isoToDate(item.issuedAt) : null,
        origin: 'SYNC',
        isCurrent: true,
      },
    });
    result.newVersions += 1;
    result.versionIdsToFetch.push(version.id);
  }
  return result;
}
