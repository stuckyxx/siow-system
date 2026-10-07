import type { Job } from 'bullmq';
import { Prisma } from '@siow/db';
import { getProvider, ProviderError } from '@siow/integrations';
import { JOB_NAMES, type SyncAllJobData, type SyncJobData } from '@siow/queue';
import { applySnapshot } from '@siow/sync-core';
import type { WorkerContext } from '../context.js';

const CIRCUIT_FAILURES = 3; // falhas consecutivas para abrir o circuito
const CIRCUIT_OPEN_MINUTES = 60;

/**
 * "Sincronizar todas": cria um SyncRun por fonte ativa e enfileira um job
 * por fonte. Fontes com circuito aberto são puladas (SKIPPED) na
 * sincronização automática; a manual sempre tenta.
 */
export async function enqueueSyncAll(ctx: WorkerContext, data: SyncAllJobData): Promise<{ enqueued: number; skipped: number }> {
  const sources = await ctx.prisma.dataSource.findMany({
    where: { isActive: true, syncEnabled: true, deletedAt: null, entity: { isActive: true, deletedAt: null } },
    select: { id: true, entityId: true, circuitOpenUntil: true },
  });
  let enqueued = 0;
  let skipped = 0;
  for (const ds of sources) {
    if (data.trigger === 'SCHEDULED' && ds.circuitOpenUntil && ds.circuitOpenUntil > new Date()) {
      await ctx.prisma.syncRun.create({
        data: {
          dataSourceId: ds.id,
          entityId: ds.entityId,
          trigger: data.trigger,
          status: 'SKIPPED',
          finishedAt: new Date(),
          errorMessage: `Circuito aberto até ${ds.circuitOpenUntil.toISOString()} após falhas consecutivas`,
        },
      });
      skipped += 1;
      continue;
    }
    const run = await ctx.prisma.syncRun.create({
      data: { dataSourceId: ds.id, entityId: ds.entityId, trigger: data.trigger, requestedByUserId: data.requestedByUserId ?? null },
    });
    const job = await ctx.queues.sync.add(
      JOB_NAMES.syncOne,
      { dataSourceId: ds.id, entityId: ds.entityId, syncRunId: run.id, trigger: data.trigger, requestedByUserId: data.requestedByUserId ?? null },
      { jobId: `sync-${ds.id}-${run.id}` },
    );
    await ctx.prisma.syncRun.update({ where: { id: run.id }, data: { jobId: job.id ?? null } });
    enqueued += 1;
  }
  ctx.logger.info({ enqueued, skipped, trigger: data.trigger }, 'sync-all enfileirado');
  return { enqueued, skipped };
}

/** Sincroniza UMA fonte de dados, registrando tudo em SyncRun. */
export async function runSyncOne(ctx: WorkerContext, job: Job<SyncJobData>): Promise<void> {
  const { dataSourceId, syncRunId } = job.data;
  const startedAt = new Date();
  const ds = await ctx.prisma.dataSource.findUnique({ where: { id: dataSourceId }, include: { entity: true } });
  if (!ds || ds.deletedAt || !ds.isActive) {
    await ctx.prisma.syncRun.update({
      where: { id: syncRunId },
      data: { status: 'SKIPPED', startedAt, finishedAt: new Date(), errorMessage: 'Fonte inativa ou removida' },
    });
    return;
  }

  await ctx.prisma.syncRun.update({
    where: { id: syncRunId },
    data: { status: 'RUNNING', startedAt, attempt: job.attemptsMade + 1, jobId: job.id ?? null },
  });

  try {
    const provider = getProvider(ds.provider);
    const snapshot = await provider.fetchSnapshot(
      { url: ds.url, config: (ds.config as Record<string, unknown> | null) ?? null },
      {
        timeoutMs: Number(process.env['SYNC_HTTP_TIMEOUT_MS'] ?? 20_000),
        userAgent: process.env['SYNC_USER_AGENT'] ?? 'SiowSystem/1.0',
        logger: { info: (m, meta) => ctx.logger.info(meta ?? {}, m), warn: (m, meta) => ctx.logger.warn(meta ?? {}, m) },
      },
    );

    const stats = await applySnapshot(ctx.prisma, { dataSourceId, entityId: ds.entityId, syncRunId, snapshot });

    // Documentos de certidões novas → fila de documentos (sem efeitos colaterais no portal)
    for (const certificateVersionId of stats.certificateVersionIdsToFetch) {
      await ctx.queues.documents.add(JOB_NAMES.fetchDocument, { kind: 'CERTIFICATE_VERSION', certificateVersionId }, { jobId: `cert-${certificateVersionId}` });
    }

    const finishedAt = new Date();
    const status = stats.warnings.length > 0 || !snapshot.invoiceListComplete ? 'PARTIAL' : 'SUCCESS';
    const { certificateVersionIdsToFetch: _omit, warnings, ...plainStats } = stats;
    await ctx.prisma.$transaction([
      ctx.prisma.syncRun.update({
        where: { id: syncRunId },
        data: {
          status,
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          stats: { ...plainStats, invoiceListComplete: snapshot.invoiceListComplete } as Prisma.InputJsonValue,
          warnings: warnings as Prisma.InputJsonValue,
        },
      }),
      ctx.prisma.dataSource.update({
        where: { id: dataSourceId },
        data: {
          lastSyncAt: finishedAt,
          lastSuccessAt: finishedAt,
          lastSyncStatus: status,
          lastSyncRunId: syncRunId,
          consecutiveFailures: 0,
          circuitOpenUntil: null,
        },
      }),
    ]);

    if (stats.conflicts > 0 || stats.missing > 0) {
      await ctx.prisma.notification.upsert({
        where: { dedupeKey: `RECONCILIATION:${syncRunId}` },
        update: {},
        create: {
          type: 'RECONCILIATION_NEEDED',
          title: `${ds.entity.shortName ?? ds.entity.name}: ${stats.conflicts} conflito(s), ${stats.missing} nota(s) ausente(s)`,
          body: 'A sincronização encontrou divergências que precisam de verificação humana.',
          entityId: ds.entityId,
          referenceType: 'syncRun',
          referenceId: syncRunId,
          dedupeKey: `RECONCILIATION:${syncRunId}`,
        },
      });
    }
    ctx.logger.info({ entity: ds.entity.shortName ?? ds.entity.name, ...plainStats }, 'sync concluída');
  } catch (err) {
    const finishedAt = new Date();
    const message = err instanceof Error ? err.message : String(err);
    const retryable = err instanceof ProviderError ? err.retryable : true;
    const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    const failures = ds.consecutiveFailures + 1;
    const openCircuit = isLastAttempt && failures >= CIRCUIT_FAILURES;

    await ctx.prisma.$transaction([
      ctx.prisma.syncRun.update({
        where: { id: syncRunId },
        data: {
          status: isLastAttempt || !retryable ? 'FAILED' : 'QUEUED',
          finishedAt: isLastAttempt || !retryable ? finishedAt : null,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          errorMessage: message.slice(0, 1000),
          errorDetails: err instanceof Error ? (err.stack ?? '').slice(0, 4000) : null,
        },
      }),
      ctx.prisma.dataSource.update({
        where: { id: dataSourceId },
        data: {
          lastSyncAt: finishedAt,
          lastSyncStatus: 'FAILED',
          lastSyncRunId: syncRunId,
          consecutiveFailures: isLastAttempt || !retryable ? failures : ds.consecutiveFailures,
          circuitOpenUntil: openCircuit ? new Date(Date.now() + CIRCUIT_OPEN_MINUTES * 60_000) : ds.circuitOpenUntil,
        },
      }),
    ]);

    if (isLastAttempt || !retryable) {
      await ctx.prisma.notification.upsert({
        where: { dedupeKey: `SYNC_FAILED:${syncRunId}` },
        update: {},
        create: {
          type: 'SYNC_FAILED',
          title: `Falha ao sincronizar ${ds.entity.shortName ?? ds.entity.name}`,
          body: message.slice(0, 500),
          entityId: ds.entityId,
          referenceType: 'syncRun',
          referenceId: syncRunId,
          dedupeKey: `SYNC_FAILED:${syncRunId}`,
        },
      });
    }
    ctx.logger.warn({ dataSourceId, attempt: job.attemptsMade + 1, retryable, err: message }, 'sync falhou');
    if (!retryable) return; // não repetir erro definitivo (ex.: página não é o portal)
    throw err; // BullMQ aplica retry com backoff exponencial
  }
}
