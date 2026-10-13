import { NextResponse } from 'next/server';
import { clearCookies, rotateSession } from '@/server/auth';
import { route } from '@/server/http';
import { RATE_RULES, rateLimit } from '@/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/auth/refresh — público. Rotaciona o refresh token; 401 se inválido/expirado. */
export const POST = route(null, async (ctx) => {
  await rateLimit(`refresh:${ctx.ip ?? 'sem-ip'}`, RATE_RULES.refresh);
  const ok = await rotateSession(ctx.req);
  if (ok) return { ok: true };
  await clearCookies();
  return NextResponse.json({ ok: false, statusCode: 401, message: 'Sessão inválida' }, { status: 401 });
});
