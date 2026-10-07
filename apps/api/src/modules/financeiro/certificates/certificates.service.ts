import { Injectable, NotFoundException } from '@nestjs/common';
import { slugify } from '@siow/sync-core';
import { dateToIso, daysBetween, isoToDate, todayIso, type CertificateStatus, type CertificateView } from '@siow/shared';
import { AuditService } from '../../../common/audit/audit.service.js';
import type { RequestContext } from '../../../common/auth/decorators.js';
import { PrismaService } from '../../../common/prisma/prisma.service.js';

@Injectable()
export class CertificatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async expiringDays(): Promise<number> {
    const s = await this.prisma.setting.findUnique({ where: { key: 'certificates.expiringDays' } });
    return typeof s?.value === 'number' ? s.value : 30;
  }

  static status(validUntil: string | null, today: string, expiringDays: number): { status: CertificateStatus; days: number | null } {
    if (!validUntil) return { status: 'UNKNOWN', days: null };
    const days = daysBetween(today, validUntil);
    if (days < 0) return { status: 'EXPIRED', days };
    if (days <= expiringDays) return { status: 'EXPIRING', days };
    return { status: 'VALID', days };
  }

  /** Certidões da empresa (entityId null) + específicas da entidade, quando informada. */
  async list(entityId?: string, statusFilter?: CertificateStatus): Promise<CertificateView[]> {
    const [expiringDays, certs] = await Promise.all([
      this.expiringDays(),
      this.prisma.certificate.findMany({
        where: { deletedAt: null, isActive: true, OR: [{ entityId: null }, ...(entityId ? [{ entityId }] : [])] },
        include: { versions: { where: { isCurrent: true }, orderBy: { capturedAt: 'desc' }, take: 1 }, _count: { select: { versions: true } } },
        orderBy: { name: 'asc' },
      }),
    ]);
    const today = todayIso();
    const views = certs.map<CertificateView>((c) => {
      const v = c.versions[0] ?? null;
      const validUntil = dateToIso(v?.validUntil ?? null);
      const { status, days } = CertificatesService.status(validUntil, today, expiringDays);
      return {
        id: c.id,
        slug: c.slug,
        name: c.name,
        entityId: c.entityId,
        status,
        daysToExpire: days,
        current: v ? { id: v.id, validUntil, issuedAt: dateToIso(v.issuedAt), capturedAt: v.capturedAt.toISOString(), documentId: v.documentId, sourceUrl: v.sourceUrl } : null,
        versionsCount: c._count.versions,
      };
    });
    return statusFilter ? views.filter((v) => v.status === statusFilter) : views;
  }

  async get(id: string) {
    const c = await this.prisma.certificate.findFirst({
      where: { id, deletedAt: null },
      include: { versions: { orderBy: { capturedAt: 'desc' }, include: { document: { select: { id: true, name: true } }, registeredBy: { select: { id: true, name: true } } } } },
    });
    if (!c) throw new NotFoundException('Certidão não encontrada');
    const expiringDays = await this.expiringDays();
    const current = c.versions.find((v) => v.isCurrent) ?? null;
    return { ...c, ...CertificatesService.status(dateToIso(current?.validUntil ?? null), todayIso(), expiringDays) };
  }

  /** Nova versão registrada manualmente (ex.: certidão renovada e enviada pelo usuário). */
  async registerVersion(ctx: RequestContext, certificateId: string, input: { documentId: string; issuedAt?: string | null; validUntil?: string | null }) {
    const cert = await this.prisma.certificate.findFirst({ where: { id: certificateId, deletedAt: null } });
    if (!cert) throw new NotFoundException('Certidão não encontrada');
    const version = await this.prisma.$transaction(async (tx) => {
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
    await this.audit.log(ctx, { action: 'CERTIFICATE_VERSION_ADDED', resource: 'certificate', resourceId: certificateId, after: version });
    return version;
  }

  async create(ctx: RequestContext, input: { name: string; entityId?: string | null; notes?: string | null }) {
    const cert = await this.prisma.certificate.create({ data: { name: input.name, slug: slugify(input.name), entityId: input.entityId ?? null, notes: input.notes ?? null } });
    await this.audit.log(ctx, { action: 'CREATE', resource: 'certificate', resourceId: cert.id, after: cert });
    return cert;
  }
}
