/* eslint-disable no-console */
/**
 * Seed via CLI: `pnpm db:seed` (lê o .env da raiz) ou, contra o Neon,
 * `DATABASE_URL=postgresql://... pnpm --filter @siow/db exec tsx prisma/seed.ts`.
 * A lógica fica em `src/seed-core.ts` (compartilhada com POST /api/admin/bootstrap).
 */
import { PrismaClient } from '@prisma/client';
import { runSeed } from '../src/seed-core.js';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL não definida. Use o .env da raiz (dotenv) ou exporte a variável.');
  process.exit(1);
}

const prisma = new PrismaClient();

runSeed(prisma, {
  adminEmail: process.env.SEED_ADMIN_EMAIL,
  adminName: process.env.SEED_ADMIN_NAME,
  adminPassword: process.env.SEED_ADMIN_PASSWORD,
  requireStrongAdminPassword: process.env.NODE_ENV === 'production',
  sampleEntities: process.env.SEED_SAMPLE_ENTITIES === 'true',
  log: console.log,
})
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
