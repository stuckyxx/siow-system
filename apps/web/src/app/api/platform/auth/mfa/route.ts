import { z } from 'zod';
import { NextResponse } from 'next/server';
import { unauthorized } from '@/server/http';
import { platformFinishLogin, platformJson, platformRoute } from '@/server/platform-auth';
import { RATE_RULES, rateLimit } from '@/server/rate-limit';
import { checkCode, disable, enable, readMfaToken, setup, status } from '@/server/services/mfa';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = platformRoute(async (ctx) => status('platform', ctx.admin.id));
export const PUT = platformRoute(async (ctx) => setup('platform', ctx.admin.id, 'Siow Plataforma'));
export const PATCH = platformRoute(async (ctx) => enable('platform', ctx.admin.id, (await platformJson(ctx.req, z.object({ code: z.string().min(6).max(8) }))).code, null));
export const DELETE = platformRoute(async (ctx) => { const b = await platformJson(ctx.req, z.object({ password: z.string().min(1), code: z.string().max(8).default('') })); return disable('platform', ctx.admin.id, b.password, b.code, null); });
export const POST = platformRoute(async (ctx) => {
  const b = await platformJson(ctx.req, z.object({ mfaToken: z.string().min(10), code: z.string().min(6).max(8) }));
  await rateLimit(`pmfa:${ctx.ip ?? 'sem-ip'}`, RATE_RULES.mfa);
  const id = await readMfaToken(b.mfaToken, 'platform');
  if (!(await checkCode('platform', id, b.code))) throw unauthorized('Código inválido');
  const admin = await platformFinishLogin(id, ctx);
  return NextResponse.json({ ok: true, admin });
}, { auth: false });
