/**
 * Prisma singleton para ambiente serverless (Vercel + Neon).
 * Use DATABASE_URL com pooler do Neon (…-pooler.neon.tech, ?pgbouncer=true)
 * e DIRECT_URL (sem pooler) apenas para migrations.
 */
import { PrismaClient } from '@siow/db';

const g = globalThis as unknown as { __prisma?: PrismaClient };
export const prisma: PrismaClient = g.__prisma ?? new PrismaClient({ log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'] });
if (process.env.NODE_ENV !== 'production') g.__prisma = prisma;
