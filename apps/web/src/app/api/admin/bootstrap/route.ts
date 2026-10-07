import { NextResponse, type NextRequest } from 'next/server';
import { runSeed } from '@siow/db';
import { cronAuthorized } from '@/server/cron';
import { prisma } from '@/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/admin/bootstrap — inicialização do banco (idempotente, pode ser repetida).
 *
 * Cria/atualiza permissões, os 4 papéis, o administrador inicial
 * (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD, troca de senha obrigatória no 1º login),
 * modelos de mensagem, configurações e os triggers que protegem `audit_logs`.
 *
 * As TABELAS precisam existir antes (prisma db push ou packages/db/prisma/schema.sql).
 *
 * Protegida por `Authorization: Bearer ${CRON_SECRET}` — a mesma chave dos crons.
 * Sem CRON_SECRET configurado, a rota fica desligada (401).
 */
export async function POST(req: NextRequest): Promise<Response> {
  if (!cronAuthorized(req)) return NextResponse.json({ statusCode: 401, message: 'Não autorizado' }, { status: 401 });

  const startedAt = new Date();
  const log: string[] = [];
  try {
    const result = await runSeed(prisma, {
      adminEmail: process.env['SEED_ADMIN_EMAIL'],
      adminName: process.env['SEED_ADMIN_NAME'],
      adminPassword: process.env['SEED_ADMIN_PASSWORD'],
      requireStrongAdminPassword: process.env.NODE_ENV === 'production',
      sampleEntities: process.env['SEED_SAMPLE_ENTITIES'] === 'true',
      log: (m) => log.push(m),
    });
    return NextResponse.json({
      ok: true,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      result,
      log,
      next: result.adminCreated
        ? `Entre em /login com ${result.adminEmail} e a senha SEED_ADMIN_PASSWORD; o sistema pedirá uma nova senha.`
        : 'Administrador já existia; nada alterado no usuário.',
    });
  } catch (e) {
    console.error('[bootstrap] falhou', e);
    const message = e instanceof Error ? e.message : String(e);
    const hint = /does not exist|relation .* não existe|P2021/i.test(message)
      ? 'As tabelas ainda não existem: execute packages/db/prisma/schema.sql no SQL Editor do Neon (ou `prisma db push`) e repita.'
      : undefined;
    return NextResponse.json({ ok: false, startedAt: startedAt.toISOString(), message, hint, log }, { status: 500 });
  }
}

/** GET informa como usar (sem revelar nada sensível). */
export async function GET(): Promise<Response> {
  return NextResponse.json({
    message: 'Use POST com o header "Authorization: Bearer <CRON_SECRET>" para inicializar o banco (idempotente).',
  });
}
