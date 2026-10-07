import { Queue, type JobsOptions } from 'bullmq';
import IORedis from 'ioredis';

/** Nomes das filas — únicos pontos de acoplamento entre API (produtor) e worker (consumidor). */
export const QUEUES = {
  sync: 'financeiro.sync',
  documents: 'financeiro.documents',
  alerts: 'financeiro.alerts',
} as const;

export type SyncTriggerKind = 'SCHEDULED' | 'MANUAL' | 'BULK' | 'RETRY';

export interface SyncJobData {
  dataSourceId: string;
  entityId: string;
  syncRunId: string;
  trigger: SyncTriggerKind;
  requestedByUserId?: string | null;
}

export interface SyncAllJobData {
  trigger: 'SCHEDULED' | 'BULK';
  requestedByUserId?: string | null;
}

export type DocumentJobData =
  | { kind: 'CERTIFICATE_VERSION'; certificateVersionId: string }
  | { kind: 'INVOICE_RECEIPT'; invoiceId: string }
  | { kind: 'INVOICE_DOCUMENT'; invoiceId: string; requestedByUserId: string };

export type AlertJobData = { kind: 'DAILY_CHECKS' };

export const JOB_NAMES = {
  syncOne: 'sync-one',
  syncAll: 'sync-all',
  fetchDocument: 'fetch-document',
  dailyChecks: 'daily-checks',
} as const;

export function createRedisConnection(url: string): IORedis {
  return new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
}

export const DEFAULT_SYNC_JOB_OPTS: JobsOptions = {
  attempts: Number(process.env['SYNC_MAX_ATTEMPTS'] ?? 4),
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 5_000 },
  removeOnFail: { age: 30 * 24 * 3600 },
};

export interface QueueSet {
  sync: Queue<SyncJobData | SyncAllJobData>;
  documents: Queue<DocumentJobData>;
  alerts: Queue<AlertJobData>;
}

export function createQueues(connection: IORedis): QueueSet {
  return {
    sync: new Queue(QUEUES.sync, { connection, defaultJobOptions: DEFAULT_SYNC_JOB_OPTS }),
    documents: new Queue(QUEUES.documents, {
      connection,
      defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: { age: 24 * 3600 } },
    }),
    alerts: new Queue(QUEUES.alerts, { connection, defaultJobOptions: { removeOnComplete: true, removeOnFail: { age: 7 * 24 * 3600 } } }),
  };
}
