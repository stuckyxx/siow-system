import { Global, Module } from '@nestjs/common';
import { createQueues, createRedisConnection, type QueueSet } from '@siow/queue';
import { DocumentStore, ObjectStorage, objectStorageConfigFromEnv } from '@siow/storage';
import { env } from '../../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const QUEUES_TOKEN = 'QUEUES';
export const OBJECT_STORAGE_TOKEN = 'OBJECT_STORAGE';
export const DOCUMENT_STORE_TOKEN = 'DOCUMENT_STORE';

/** Infraestrutura compartilhada pela plataforma: filas (produtor) e armazenamento de objetos. */
@Global()
@Module({
  providers: [
    {
      provide: QUEUES_TOKEN,
      useFactory: (): QueueSet => createQueues(createRedisConnection(env().REDIS_URL)),
    },
    {
      provide: OBJECT_STORAGE_TOKEN,
      useFactory: (): ObjectStorage => new ObjectStorage(objectStorageConfigFromEnv()),
    },
    {
      provide: DOCUMENT_STORE_TOKEN,
      inject: [PrismaService, OBJECT_STORAGE_TOKEN],
      useFactory: (prisma: PrismaService, storage: ObjectStorage): DocumentStore => new DocumentStore(prisma, storage),
    },
  ],
  exports: [QUEUES_TOKEN, OBJECT_STORAGE_TOKEN, DOCUMENT_STORE_TOKEN],
})
export class InfraModule {}
