/**
 * Sincronização SEM worker/fila (Vercel + Neon): cada fonte é sincronizada
 * dentro da própria requisição (manual, "todas" ou cron). Substitui
 * apps/worker/src/jobs/sync.ts + o SyncService do NestJS.
 *
 *  - syncOne: uma fonte → SyncRun (QUEUED→RUNNING→SUCCESS/PARTIAL/FAILED), circuit breaker na DataSource.
 *  - syncBatch: várias fontes, ordenadas pela sincronização mais antiga, com orçamento de tempo
 *    (budgetMs) — o que não couber fica para a próxima execução (remaining).
 *  - documentos de certidões: baixados UMA vez por lote (não por entidade).
 */
import type { Prisma, SyncStatus, SyncTrigger } from '@siow/db';
import { getProvider, ProviderError, type ProviderContext } from '@siow/integrations';
import { applySnapshot } from '@siow/sync-core';
import type { z } from 'zod';
import type { syncRunListFilterSchema } from '@siow/shared';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { audit } from '../audit.js';
import { conflict, notFound, type Ctx } from '../http.js';
import { storeDocument } from './documents.js';

const CIRCUIT_FAILURES = 3; // falhas consecutivas para abrir o circuito
const CIRCUIT_OPEN_MINUTES = 60;
/** Execução RUNNING mais antiga que isto é considerada abandonada (função serverless morreu). */
export const STALE_RUNNING_MS = 10 * 60_000;
/** Agenda do cron (vercel.json / GitHub Actions) — exibida no painel de monitoramento. */
export const SYNC_CRON_PATTERN = process.env['SYNC_CRON'] ?? '0 */6 * * *';

const providerCtx = (): ProviderContext => ({
  timeoutMs: Number(process.env['SYNC_HTTP_TIMEOUT_MS'] ?? 20_000),
  userAgent: process.env['SYNC_USER_AGENT'] ?? 'SiowSystem/1.0',
  logger: { info: (m, meta) => console.info('[sync]', m, meta ?? ''), warn: (m, meta) => console.warn('[sync]', m, meta ?? '') },
});

export interface SyncOneOptions {
  trigger: SyncTrigger;
  requestedByUserId?: string | null;
  /** Ignora o circuito aberto (sincronização manual sempre tenta). */
  ignoreCircuit?: boolean;
}

export interface SyncOneResult {
  runId: string;
  dataSourceId: string;
  entityId: string;
  status: SyncStatus;
  durationMs: number;
  errorMessage: string | null;
  stats: Record<string, unknown> | null;
  warnings: string[];
  certificateVersionIdsToFetch: string[];
}

/**
 * Marca como FAILED execuções RUNNING/QUEUED abandonadas da fonte e informa se
 * ainda existe uma execução recente em andamento.
 */
async function hasRecentRunning(dataSourceId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - STALE_RUNNING_MS);
  await prisma.syncRun.updateMany({
    where: { dataSourceId, status: { in: ['QUEUED', 'RUNNING'] }, queuedAt: { lt: cutoff } },
    data: { status: 'FAILED', finishedAt: new Date(), errorMessage: 'Execução abandonada: ultrapassou o tempo máximo sem concluir' },
  });
  const running = await prisma.syncRun.findFirst({ where: { dataSourceId, status: { in: ['QUEUED', 'RUNNING'] }, queuedAt: { gte: cutoff } }, select: { id: true } });
  return Boolean(running);
}

/** Sincroniza UMA fonte de dados, registrando tudo em SyncRun. Nunca lança: o erro fica no SyncRun. */
export async function syncOne(dataSourceId: string, opts: SyncOneOptions): Promise<SyncOneResult | null> {
  const ds = await prisma.dataSource.findUnique({ where: { id: dataSourceId }, include: { entity: true } });
  if (!ds) return null;
  if (await hasRecentRunning(dataSourceId)) return null;

  const skip = async (errorMessage: string): Promise<SyncOneResult> => {
    const run = await prisma.syncRun.create({ data: { dataSourceId, entityId: ds.entityId, trigger: opts.trigger, requestedByUserId: opts.requestedByUserId ?? null, status: 'SKIPPED', startedAt: new Date(), finishedAt: new Date(), errorMessage } });
    return { runId: run.id, dataSourceId, entityId: ds.entityId, status: 'SKIPPED', durationMs: 0, errorMessage, stats: null, warnings: [], certificateVersionIdsToFetch: [] };
  };
  if (ds.deletedAt || !ds.isActive) return skip('Fonte inativa ou removida');
  if (!opts.ignoreCircuit && ds.circuitOpenUntil && ds.circuitOpenUntil > new Date()) return skip(`Circuito aberto até ${ds.circuitOpenUntil.toISOString()} após falhas consecutivas`);

  const startedAt = new Date();
  const run = await prisma.syncRun.create({ data: { dataSourceId, entityId: ds.entityId, trigger: opts.trigger, requestedByUserId: opts.requestedByUserId ?? null, status: 'RUNNING', startedAt, attempt: 1 } });
  const syncRunId = run.id;

  try {
    const provider = getProvider(ds.provider);
    const snapshot = await provider.fetchSnapshot({ url: ds.url, config: (ds.config as Record<string, unknown> | null) ?? null }, providerCtx());
    const stats = await applySnapshot(prisma, { dataSourceId, entityId: ds.entityId, syncRunId, snapshot });

    const finishedAt = new Date();
    const status: SyncStatus = stats.warnings.length > 0 || !snapshot.invoiceListComplete ? 'PARTIAL' : 'SUCCESS';
    const { certificateVersionIdsToFetch, warnings, ...plainStats } = stats;
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    await prisma.$transaction([
      prisma.syncRun.update({
        where: { id: syncRunId },
        data: { status, finishedAt, durationMs, stats: { ...plainStats, invoiceListComplete: snapshot.invoiceListComplete } as Prisma.InputJsonValue, warnings: warnings as Prisma.InputJsonValue },
      }),
      prisma.dataSource.update({
        where: { id: dataSourceId },
        data: { lastSyncAt: finishedAt, lastSuccessAt: finishedAt, lastSyncStatus: status, lastSyncRunId: syncRunId, consecutiveFailures: 0, circuitOpenUntil: null },
      }),
    ]);

    if (stats.conflicts > 0 || stats.missing > 0) {
      await prisma.notification.upsert({
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
    return { runId: syncRunId, dataSourceId, entityId: ds.entityId, status, durationMs, errorMessage: null, stats: { ...plainStats, invoiceListComplete: snapshot.invoiceListComplete }, warnings, certificateVersionIdsToFetch };
  } catch (err) {
    const finishedAt = new Date();
    const message = err instanceof Error ? err.message : String(err);
    const retryable = err instanceof ProviderError ? err.retryable : true;
    // Sem fila não há nova tentativa automática nesta execução: a próxima rodada do cron tenta de novo.
    const failures = ds.consecutiveFailures + 1;
    const openCircuit = failures >= CIRCUIT_FAILURES;
    const durationMs = finishedAt.getTime() - startedAt.getTime();

    await prisma.$transaction([
      prisma.syncRun.update({
        where: { id: syncRunId },
        data: { status: 'FAILED', finishedAt, durationMs, errorMessage: message.slice(0, 1000), errorDetails: err instanceof Error ? (err.stack ?? '').slice(0, 4000) : null },
      }),
      prisma.dataSource.update({
        where: { id: dataSourceId },
        data: {
          lastSyncAt: finishedAt,
          lastSyncStatus: 'FAILED',
          lastSyncRunId: syncRunId,
          consecutiveFailures: failures,
          circuitOpenUntil: openCircuit ? new Date(Date.now() + CIRCUIT_OPEN_MINUTES * 60_000) : ds.circuitOpenUntil,
        },
      }),
    ]);
    await prisma.notification.upsert({
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
    console.warn('[sync] falhou', { dataSourceId, retryable, err: message });
    return { runId: syncRunId, dataSourceId, entityId: ds.entityId, status: 'FAILED', durationMs, errorMessage: message, stats: null, warnings: [], certificateVersionIdsToFetch: [] };
  }
}

/**
 * Baixa os PDFs de certidões ainda sem documento (GET sem efeitos colaterais no portal).
 * Chamado UMA vez por lote — as certidões são da empresa e aparecem em todas as entidades.
 * Substitui o job CERTIFICATE_VERSION de apps/worker/src/jobs/documents.ts.
 */
export async function fetchPendingCertificateDocuments(opts: { ids?: string[]; limit?: number; deadline?: number } = {}): Promise<{ fetched: number; failed: number; remaining: number }> {
  const where: Prisma.CertificateVersionWhereInput = { documentId: null, sourceUrl: { not: null }, ...(opts.ids ? { id: { in: opts.ids } } : {}) };
  const versions = await prisma.certificateVersion.findMany({ where, include: { certificate: true }, orderBy: { capturedAt: 'desc' }, take: opts.limit ?? 50 });
  let fetched = 0;
  let failed = 0;
  let i = 0;
  const provider = getProvider('ASSESI_PORTAL');
  for (; i < versions.length; i++) {
    if (opts.deadline && Date.now() > opts.deadline) break;
    const v = versions[i]!;
    try {
      const file = await provider.fetchDocument({ kind: 'CERTIFICATE', url: v.sourceUrl!, method: 'GET' }, providerCtx());
      const { documentId } = await storeDocument({
        buffer: file.buffer,
        mimeType: file.mimeType,
        name: `${v.certificate.name}${v.validUntil ? ` - válida até ${v.validUntil.toISOString().slice(0, 10)}` : ''}.pdf`,
        type: 'CERTIFICATE',
        entityId: v.certificate.entityId,
        originalUrl: v.sourceUrl,
        sourceDate: v.issuedAt,
        origin: 'SYNC',
      });
      await prisma.certificateVersion.update({ where: { id: v.id }, data: { documentId } });
      fetched += 1;
    } catch (e) {
      failed += 1;
      console.error('[sync] falha ao baixar certidão', v.id, e);
    }
  }
  return { fetched, failed, remaining: versions.length - i };
}

export interface SyncBatchOptions {
  trigger: SyncTrigger;
  requestedByUserId?: string | null;
  /** Restringe o lote a estas fontes (ignora syncEnabled). */
  dataSourceIds?: string[];
  /** Orçamento de tempo; nenhuma fonte nova começa depois de esgotado. Padrão: env().SYNC_BUDGET_MS. */
  budgetMs?: number;
}

export interface SyncBatchResult {
  /** fontes sincronizadas nesta chamada (qualquer resultado) */
  processed: number;
  /** puladas (circuito aberto, fonte inativa, execução recente em andamento) */
  skipped: number;
  /** não iniciadas por falta de tempo — ficam para a próxima execução */
  remaining: number;
  succeeded: number;
  failed: number;
  durationMs: number;
  certificates: { fetched: number; failed: number; remaining: number };
  runs: Array<Pick<SyncOneResult, 'runId' | 'dataSourceId' | 'entityId' | 'status' | 'durationMs' | 'errorMessage'>>;
}

/**
 * Sincroniza várias fontes dentro de um orçamento de tempo, da mais antiga
 * (lastSyncAt nulo primeiro) para a mais recente. Concorrência: env().SYNC_CONCURRENCY.
 */
/** Janela para considerar uma fonte "em dia" no contador de restantes do lote. */
const REMAINING_STALE_MS = 60 * 60_000;

export async function syncBatch(opts: SyncBatchOptions): Promise<SyncBatchResult> {
  const startedAt = Date.now();
  const budgetMs = opts.budgetMs ?? env().SYNC_BUDGET_MS;
  const deadline = startedAt + budgetMs;
  const concurrency = Math.max(1, env().SYNC_CONCURRENCY);
  const scheduled = opts.trigger === 'SCHEDULED';

  const sources = await prisma.dataSource.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      ...(opts.dataSourceIds ? { id: { in: opts.dataSourceIds } } : { syncEnabled: true, entity: { isActive: true, deletedAt: null } }),
    },
    select: { id: true, entityId: true, circuitOpenUntil: true, lastSyncAt: true },
    orderBy: [{ lastSyncAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
  });

  const result: SyncBatchResult = { processed: 0, skipped: 0, remaining: 0, succeeded: 0, failed: 0, durationMs: 0, certificates: { fetched: 0, failed: 0, remaining: 0 }, runs: [] };
  const certIds = new Set<string>();
  const queue = [...sources];

  const worker = async (): Promise<void> => {
    for (;;) {
      if (Date.now() >= deadline) return;
      const ds = queue.shift();
      if (!ds) return;
      // circuito aberto: só o agendamento automático pula (manual/bulk sempre tenta)
      const r = await syncOne(ds.id, { trigger: opts.trigger, requestedByUserId: opts.requestedByUserId ?? null, ignoreCircuit: !scheduled });
      if (!r) { result.skipped += 1; continue; }
      result.runs.push({ runId: r.runId, dataSourceId: r.dataSourceId, entityId: r.entityId, status: r.status, durationMs: r.durationMs, errorMessage: r.errorMessage });
      if (r.status === 'SKIPPED') { result.skipped += 1; continue; }
      result.processed += 1;
      if (r.status === 'FAILED') result.failed += 1;
      else result.succeeded += 1;
      for (const id of r.certificateVersionIdsToFetch) certIds.add(id);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length || 1) }, () => worker()));
  // "Restantes" = fontes que ficaram fora deste lote e ainda estão desatualizadas (nunca sincronizadas ou há mais de
  // REMAINING_STALE_MS). As que sobraram na fila por já estarem em dia não contam — senão o contador nunca chegaria a zero.
  const staleBefore = startedAt - REMAINING_STALE_MS;
  result.remaining = queue.filter((ds) => !ds.lastSyncAt || ds.lastSyncAt.getTime() < staleBefore).length;

  // Certidões: uma única passada por lote (inclui pendências de lotes anteriores).
  try {
    result.certificates = await fetchPendingCertificateDocuments({ deadline: deadline + 10_000 });
  } catch (e) {
    console.error('[sync] certidões', e);
  }
  result.durationMs = Date.now() - startedAt;
  console.info('[sync] lote concluído', { trigger: opts.trigger, ...result, runs: undefined });
  return result;
}

// ---------------------------------------------------------------------------
//  Operações do controller (antes: SyncService do NestJS)
// ---------------------------------------------------------------------------

/** "Sincronizar agora" para uma entidade: executa inline todas as fontes ativas dela e devolve as execuções. */
export async function syncEntityNow(ctx: Ctx, entityId: string) {
  const sources = await prisma.dataSource.findMany({ where: { entityId, isActive: true, deletedAt: null }, select: { id: true } });
  if (sources.length === 0) throw notFound('Entidade sem fonte de dados ativa');
  const cutoff = new Date(Date.now() - STALE_RUNNING_MS);
  const running = await prisma.syncRun.findFirst({ where: { dataSourceId: { in: sources.map((s) => s.id) }, status: { in: ['QUEUED', 'RUNNING'] }, queuedAt: { gte: cutoff } }, select: { id: true } });
  if (running) throw conflict('Já existe uma sincronização em andamento para esta entidade');

  const batch = await syncBatch({ trigger: 'MANUAL', requestedByUserId: ctx.user.id, dataSourceIds: sources.map((s) => s.id) });
  await audit(ctx, { action: 'SYNC_REQUESTED', resource: 'entity', resourceId: entityId, after: { runs: batch.runs.map((r) => r.runId), processed: batch.processed, skipped: batch.skipped } });
  const runs = await prisma.syncRun.findMany({
    where: { id: { in: batch.runs.map((r) => r.runId) } },
    include: { entity: { select: { id: true, name: true, shortName: true } }, dataSource: { select: { id: true, url: true, label: true } } },
    orderBy: { queuedAt: 'asc' },
  });
  return runs;
}

/** Ação administrativa: sincronizar todas as entidades (inline, dentro do orçamento de tempo). */
export async function syncAllNow(ctx: Ctx) {
  const batch = await syncBatch({ trigger: 'BULK', requestedByUserId: ctx.user.id });
  await audit(ctx, { action: 'SYNC_ALL_REQUESTED', resource: 'sync', after: { processed: batch.processed, skipped: batch.skipped, remaining: batch.remaining, failed: batch.failed } });
  const { runs: _runs, ...counts } = batch;
  return counts;
}

export async function listRuns(f: z.infer<typeof syncRunListFilterSchema>) {
  const where: Prisma.SyncRunWhereInput = { entityId: f.entityId, status: f.status };
  const [items, total] = await Promise.all([
    prisma.syncRun.findMany({
      where,
      include: { entity: { select: { id: true, name: true, shortName: true } }, dataSource: { select: { id: true, url: true, label: true } }, requestedBy: { select: { id: true, name: true } } },
      orderBy: { queuedAt: 'desc' },
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
    }),
    prisma.syncRun.count({ where }),
  ]);
  return { items, total, page: f.page, pageSize: f.pageSize };
}

export async function getRun(id: string) {
  const run = await prisma.syncRun.findUnique({
    where: { id },
    include: {
      entity: { select: { id: true, name: true, shortName: true } },
      dataSource: true,
      requestedBy: { select: { id: true, name: true } },
      invoiceEvents: { include: { invoice: { select: { id: true, number: true } } }, orderBy: { createdAt: 'asc' } },
      conflicts: { include: { invoice: { select: { id: true, number: true } } } },
    },
  });
  if (!run) throw notFound('Execução não encontrada');
  return run;
}

/** Próxima execução de um cron simples ("M H * * *" ou "M *\/N * * *"), em UTC. */
export function nextCronRun(pattern: string, from = new Date()): Date | null {
  const [min, hour] = pattern.trim().split(/\s+/);
  const minute = Number(min);
  if (!Number.isInteger(minute) || hour === undefined) return null;
  const hours: number[] = [];
  const every = /^\*\/(\d+)$/.exec(hour);
  if (hour === '*') for (let h = 0; h < 24; h++) hours.push(h);
  else if (every) for (let h = 0; h < 24; h += Number(every[1])) hours.push(h);
  else if (/^\d+$/.test(hour)) hours.push(Number(hour));
  else return null;
  for (let day = 0; day < 2; day++) {
    for (const h of hours) {
      const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + day, h, minute, 0, 0));
      if (d > from) return d;
    }
  }
  return null;
}

/** Painel de monitoramento: estado das fontes, execuções recentes e agenda do cron. */
export async function overview() {
  const since = new Date(Date.now() - 86_400_000);
  const cutoff = new Date(Date.now() - STALE_RUNNING_MS);
  const [sources, last24h, waiting, active, failed] = await Promise.all([
    prisma.dataSource.findMany({
      where: { deletedAt: null },
      include: { entity: { select: { id: true, name: true, shortName: true, type: true } } },
      orderBy: [{ lastSyncAt: 'desc' }],
    }),
    prisma.syncRun.groupBy({ by: ['status'], where: { queuedAt: { gte: since } }, _count: true }),
    prisma.syncRun.count({ where: { status: 'QUEUED', queuedAt: { gte: cutoff } } }),
    prisma.syncRun.count({ where: { status: 'RUNNING', queuedAt: { gte: cutoff } } }),
    prisma.syncRun.count({ where: { status: 'FAILED', queuedAt: { gte: since } } }),
  ]);
  const next = nextCronRun(SYNC_CRON_PATTERN);
  return {
    sources,
    last24h: Object.fromEntries(last24h.map((g) => [g.status, g._count])),
    queue: { waiting, active, delayed: 0, failed },
    schedule: { pattern: SYNC_CRON_PATTERN, next: next ? next.toISOString() : null, tz: 'UTC' },
  };
}
