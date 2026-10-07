/**
 * Certidões (spec §13): da empresa (entityId null) e específicas por entidade,
 * com versionamento e cálculo de situação (válida / vencendo / vencida).
 */
import { slugify } from '@siow/sync-core';
import { dateToIso, daysBetween, isoToDate, todayIso, type CertificateStatus, type CertificateView } from '@siow/shared';
import { prisma } from '../db.js';
import { audit } from '../audit.js';
import { notFound, type Ctx } from '../http.js';

export async function expiringDays(): Promise<number> {
  const s = await prisma.setting.findUnique({ where: { key: 'certificates.expiringDays' } });
  return typeof s?.value === 'number' ? s.value : 30;
}

export function status(validUntil: string | null, today: string, expiring: number): { status: CertificateStatus; days: number | null } {
  if (!validUntil) return { status: 'UNKNOWN', days: null };
  const days = daysBetween(today, validUntil);
  if (days < 0) return { status: 'EXPIRED', days };
  if (days <= expiring) return { status: 'EXPIRING', days };
  return { status: 'VALID', days };
}

/** Certidões da empresa (entityId null) + específicas da entidade, quando informada. */
export async function list(entityId?: string, statusFilter?: CertificateStatus): Promise<CertificateView[]> {
  const [expiring, certs] = await Promise.all([
    expiringDays(),
    prisma.certificate.findMany({
      where: { deletedAt: null, isActive: true, OR: [{ entityId: null }, ...(entityId ? [{ entityId }] : [])] },
      include: { versions: { where: { isCurrent: true }, orderBy: { capturedAt: 'desc' }, take: 1 }, _count: { select: { versions: true } } },
      orderBy: { name: 'asc' },
    }),
  ]);
  const today = todayIso();
  const views = certs.map<CertificateView>((c) => {
    const v = c.versions[0] ?? null;
    const validUntil = dateToIso(v?.validUntil ?? null);
    const { status: st, days } = status(validUntil, today, expiring);
    return {
      id: c.id,
      slug: c.slug,
      name: c.name,
      entityId: c.entityId,
      status: st,
      daysToExpire: days,
      current: v ? { id: v.id, validUntil, issuedAt: dateToIso(v.issuedAt), capturedAt: v.capturedAt.toISOString(), documentId: v.documentId, sourceUrl: v.sourceUrl } : null,
      versionsCount: c._count.versions,
    };
  });
  return statusFilter ? views.filter((v) => v.status === statusFilter) : views;
}

export async function get(id: string) {
  const c = await prisma.certificate.findFirst({
    where: { id, deletedAt: null },
    include: { versions: { orderBy: { capturedAt: 'desc' }, include: { document: { select: { id: true, name: true } }, registeredBy: { select: { id: true, name: true } } } } },
  });
  if (!c) throw notFound('Certidão não encontrada');
  const expiring = await expiringDays();
  const current = c.versions.find((v) => v.isCurrent) ?? null;
  return { ...c, ...status(dateToIso(current?.validUntil ?? null), todayIso(), expiring) };
}

/** Nova versão registrada manualmente (ex.: certidão renovada e enviada pelo usuário). */
export async function registerVersion(ctx: Ctx, certificateId: string, input: { documentId: string; issuedAt?: string | null; validUntil?: string | null }) {
  const cert = await prisma.certificate.findFirst({ where: { id: certificateId, deletedAt: null } });
  if (!cert) throw notFound('Certidão não encontrada');
  const version = await prisma.$transaction(async (tx) => {
    await tx.certificateVersion.updateMany({ where: { certificateId, isCurrent: true }, data: { isCurrent: false } });
    return tx.certificateVersion.create({
      data: {
        certificateId,
        documentId: input.documentId,
        issuedAt: input.issuedAt ? isoToDate(input.issuedAt) : null,
        validUntil: input.validUntil ? isoToDate(input.validUntil) : null,
        origin: 'MANUAL',
        registeredByUserId: ctx.user.id,
        isCurrent: true,
      },
    });
  });
  await audit(ctx, { action: 'CERTIFICATE_VERSION_ADDED', resource: 'certificate', resourceId: certificateId, after: version });
  return version;
}

export async function create(ctx: Ctx, input: { name: string; entityId?: string | null; notes?: string | null }) {
  const cert = await prisma.certificate.create({ data: { name: input.name, slug: slugify(input.name), entityId: input.entityId ?? null, notes: input.notes ?? null } });
  await audit(ctx, { action: 'CREATE', resource: 'certificate', resourceId: cert.id, after: cert });
  return cert;
}
