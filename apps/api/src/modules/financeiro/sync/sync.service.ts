import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@siow/db';
import { JOB_NAMES, type QueueSet } from '@siow/queue';
import type { z } from 'zod';
import type { syncRunListFilterSchema } from '@siow/shared';
import { AuditService } from '../../../common/audit/audit.service.js';
import type { RequestContext } from '../../../common/auth/decorators.js';
import { QUEUES_TOKEN } from '../../../common/infra/infra.module.js';
import { PrismaService } from '../../../common/prisma/prisma.service.js';

@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(QUEUES_TOKEN) private readonly queues: QueueSet,
  ) {}

  /** "Sincronizar agora" para uma entidade (todas as fontes ativas dela). */
  async syncEntityNow(ctx: RequestContext, entityId: string) {
    const sources = await this.prisma.dataSource.findMany({ where: { entityId, isActive: true, deletedAt: null } });
    if (sources.length === 0) throw new NotFoundException('Entidade sem fonte de dados ativa');
    const runs = [];
    for (const ds of sources) {
      const running = await this.prisma.syncRun.findFirst({ where: { dataSourceId: ds.id, status: { in: ['QUEUED', 'RUNNING'] } } });
      if (running) throw new ConflictException('Já existe uma sincronização em andamento para esta entidade');
      const run = await this.prisma.syncRun.create({ data: { dataSourceId: ds.id, entityId, trigger: 'MANUAL', requestedByUserId: ctx.user.id } });
      const job = await this.queues.sync.add(
        JOB_NAMES.syncOne,
        { dataSourceId: ds.id, entityId, syncRunId: run.id, trigger: 'MANUAL', requestedByUserId: ctx.user.id },
        { jobId: `sync-${ds.id}-${run.id}`, priority: 1 },
      );
      await this.prisma.syncRun.update({ where: { id: run.id }, data: { jobId: job.id ?? null } });
      runs.push(run);
    }
    await this.audit.log(ctx, { action: 'SYNC_REQUESTED', resource: 'entity', resourceId: entityId, after: { runs: runs.map((r) => r.id) } });
    return runs;
  }

  /** Ação administrativa: sincronizar todas as entidades. */
  async syncAllNow(ctx: RequestContext) {
    const job = await this.queues.sync.add(JOB_NAMES.syncAll, { trigger: 'BULK', requestedByUserId: ctx.user.id }, { jobId: `sync-all-${Date.now()}`, attempts: 1 });
    await this.audit.log(ctx, { action: 'SYNC_ALL_REQUESTED', resource: 'sync', after: { jobId: job.id } });
    return { jobId: job.id };
  }

  async listRuns(f: z.infer<typeof syncRunListFilterSchema>) {
    const where: Prisma.SyncRunWhereInput = { entityId: f.entityId, status: f.status };
    const [items, total] = await Promise.all([
      this.prisma.syncRun.findMany({
        where,
        include: { entity: { select: { id: true, name: true, shortName: true } }, dataSource: { select: { id: true, url: true, label: true } }, requestedBy: { select: { id: true, name: true } } },
        orderBy: { queuedAt: 'desc' },
        skip: (f.page - 1) * f.pageSize,
        take: f.pageSize,
      }),
      this.prisma.syncRun.count({ where }),
    ]);
    return { items, total, page: f.page, pageSize: f.pageSize };
  }

  async getRun(id: string) {
    const run = await this.prisma.syncRun.findUnique({
      where: { id },
      include: {
        entity: { select: { id: true, name: true, shortName: true } },
        dataSource: true,
        requestedBy: { select: { id: true, name: true } },
        invoiceEvents: { include: { invoice: { select: { id: true, number: true } } }, orderBy: { createdAt: 'asc' } },
        conflicts: { include: { invoice: { select: { id: true, number: true } } } },
      },
    });
    if (!run) throw new NotFoundException('Execução não encontrada');
    return run;
  }

  /** Painel de monitoramento: estado das fontes + próxima execução agendada. */
  async overview() {
    const [sources, last24h, scheduler, counts] = await Promise.all([
      this.prisma.dataSource.findMany({
        where: { deletedAt: null },
        include: { entity: { select: { id: true, name: true, shortName: true, type: true } } },
        orderBy: [{ lastSyncAt: 'desc' }],
      }),
      this.prisma.syncRun.groupBy({ by: ['status'], where: { queuedAt: { gte: new Date(Date.now() - 86_400_000) } }, _count: true }),
      this.queues.sync.getJobSchedulers(0, 10),
      this.queues.sync.getJobCounts('waiting', 'active', 'delayed', 'failed'),
    ]);
    const s = scheduler.find((x) => x.key === 'sync-all-scheduled' || x.id === 'sync-all-scheduled');
    return {
      sources,
      last24h: Object.fromEntries(last24h.map((g) => [g.status, g._count])),
      queue: counts,
      schedule: s ? { pattern: s.pattern ?? null, next: s.next ? new Date(s.next).toISOString() : null, tz: s.tz ?? null } : null,
    };
  }
}
