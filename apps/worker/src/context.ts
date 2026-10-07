import type { PrismaClient } from '@siow/db';
import type { QueueSet } from '@siow/queue';
import type { DocumentStore, ObjectStorage } from '@siow/storage';
import type { Logger } from './logger.js';

export interface WorkerContext {
  prisma: PrismaClient;
  queues: QueueSet;
  storage: ObjectStorage;
  documents: DocumentStore;
  logger: Logger;
}
