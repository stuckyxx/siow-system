import { config } from 'dotenv';
import { resolve } from 'node:path';

// Carrega o .env da raiz do monorepo (apps/<app> -> ../../.env) e, em seguida,
// um .env local (se existir) que pode sobrescrever valores.
config({ path: resolve(process.cwd(), '../../.env') });
config();
import { Worker } from 'bullmq';
import { PrismaClient } from '@siow/db';
import { QUEUES, createQueues, createRedisConnection, type AlertJobData, type DocumentJobData, type SyncAllJobData, type SyncJobData } from '@siow/queue';
import { ObjectStorage, DocumentStore, objectStorageConfigFromEnv } from '@siow/storage';
import { logger } from './logger.js';
import { runSyncOne, enqueueSyncAll } from './jobs/sync.js';
import { runFetchDocument } from './jobs/documents.js';
import { runDailyChecks } from './jobs/alerts.js';
import { installSchedules } from './scheduler.js';

/**
 * Worker de background — separado da API (spec §6).
 * Consome: sincronizações, download de documentos e verificações diárias.
 */
async function main(): Promise<void> {
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const connection = createRedisConnection(redisUrl);
  const prisma = new PrismaClient();
  const queues = createQueues(connection);
  const storage = new ObjectStorage(objectStorageConfigFromEnv());
  const documents = new DocumentStore(prisma, storage);
  const ctx = { prisma, queues, storage, documents, logger };

  const concurrency = Number(process.env['SYNC_CONCURRENCY'] ?? 3);

  const syncWorker = new Worker<SyncJobData | SyncAllJobData>(
    QUEUES.sync,
    async (job) => {
      if (job.name === 'sync-all') return enqueueSyncAll(ctx, job.data as SyncAllJobData);
      return runSyncOne(ctx, job as Parameters<typeof runSyncOne>[1]);
    },
    { connection, concurrency, lockDuration: 180_000 },
  );

  const docWorker = new Worker<DocumentJobData>(QUEUES.documents, (job) => runFetchDocument(ctx, job), {
    connection,
    concurrency: 2,
  });

  const alertWorker = new Worker<AlertJobData>(QUEUES.alerts, () => runDailyChecks(ctx), { connection, concurrency: 1 });

  for (const w of [syncWorker, docWorker, alertWorker]) {
    w.on('failed', (job, err) => logger.error({ queue: w.name, jobId: job?.id, err: err.message }, 'job failed'));
    w.on('completed', (job) => logger.info({ queue: w.name, jobId: job.id, name: job.name }, 'job completed'));
    w.on('error', (err) => logger.error({ queue: w.name, err: err.message }, 'worker error'));
  }

  await installSchedules(ctx);
  logger.info({ concurrency }, 'worker iniciado');

  const shutdown = async (): Promise<void> => {
    logger.info('encerrando worker...');
    await Promise.allSettled([syncWorker.close(), docWorker.close(), alertWorker.close()]);
    await prisma.$disconnect();
    await connection.quit();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, 'falha ao iniciar worker');
  process.exit(1);
});
