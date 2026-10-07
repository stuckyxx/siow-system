/**
 * Autenticação das rotas de cron (Vercel Cron / GitHub Actions):
 * header `Authorization: Bearer ${CRON_SECRET}`. Sem CRON_SECRET configurado, as rotas ficam desligadas.
 */
import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { env } from './env.js';

export function cronAuthorized(req: NextRequest): boolean {
  const secret = env().CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Envolve um job de cron: valida o bearer, executa e devolve JSON (500 com mensagem em caso de erro). */
export function cronRoute(job: (req: NextRequest) => Promise<unknown>) {
  return async (req: NextRequest): Promise<Response> => {
    if (!cronAuthorized(req)) return NextResponse.json({ statusCode: 401, message: 'Não autorizado' }, { status: 401 });
    const startedAt = new Date();
    try {
      const result = await job(req);
      return NextResponse.json({ ok: true, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(), result });
    } catch (e) {
      console.error('[cron] falhou', e);
      return NextResponse.json({ ok: false, startedAt: startedAt.toISOString(), message: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  };
}
