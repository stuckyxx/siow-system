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
const ORG = '7a1b5c3e-5e1f-4a4e-8c0d-000000000001';

prisma.organization
  .upsert({ where: { id: ORG }, update: {}, create: { id: ORG, name: 'Siow System Tecnologia', slug: 'siow-system-tecnologia' } })
  .then(() => runSeed(prisma, {
  organizationId: ORG,
  adminEmail: process.env.SEED_ADMIN_EMAIL,
  adminName: process.env.SEED_ADMIN_NAME,
  adminPassword: process.env.SEED_ADMIN_PASSWORD,
  requireStrongAdminPassword: process.env.NODE_ENV === 'production',
  sampleEntities: process.env.SEED_SAMPLE_ENTITIES === 'true',
  log: console.log,
}))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
