/**
 * Prisma singleton para ambiente serverless (Vercel + Neon), com a extensão de tenant:
 * toda operação em modelo de negócio é filtrada/preenchida pela organização do contexto
 * (ver tenant.ts). Use DATABASE_URL com pooler do Neon e DIRECT_URL só para migrations.
 */
import { PrismaClient, tenantExtension } from '@siow/db';
import { tenantContext } from './tenant.js';

const g = globalThis as unknown as { __prismaBase?: PrismaClient };
/** Cliente sem extensão — só para operações de plataforma explícitas (organizações, bootstrap, cron). */
export const prismaPlatform: PrismaClient = g.__prismaBase ?? new PrismaClient({ log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'] });
if (process.env.NODE_ENV !== 'production') g.__prismaBase = prismaPlatform;

/**
 * Cliente de uso geral (filtrado por organização). O tipo é apresentado como PrismaClient para manter
 * compatibilidade com os serviços e pacotes (sync-core, seed); em runtime é o cliente estendido.
 */
export const prisma: PrismaClient = prismaPlatform.$extends(tenantExtension(tenantContext)) as unknown as PrismaClient;
