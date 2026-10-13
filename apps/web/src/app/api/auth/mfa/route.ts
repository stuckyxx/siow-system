import { z } from 'zod';
import { json, route, unauthorized } from '@/server/http';
import { prisma } from '@/server/db';
import { runAsPlatform } from '@/server/tenant';
import { RATE_RULES, rateLimit } from '@/server/rate-limit';
import { checkCode, disable, enable, readMfaToken, setup, status } from '@/server/services/mfa';
import { finishLogin } from '@/server/services/auth';
import { audit } from '@/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const codeSchema = z.object({ code: z.string().min(6).max(8) });

/** GET — situação do 2FA do usuário. */
export const GET = route([], async (ctx) => status('user', ctx.user.id));
/** PUT — inicia a configuração (segredo + otpauth). */
export const PUT = route([], async (ctx) => setup('user', ctx.user.id, ctx.user.organization.branding['productName'] as string | undefined || 'Siow System'));
/** PATCH { code } — confirma e ativa. */
export const PATCH = route([], async (ctx) => enable('user', ctx.user.id, (await json(ctx.req, codeSchema)).code, ctx));
/** DELETE { password, code } — desativa. */
export const DELETE = route([], async (ctx) => { const b = await json(ctx.req, z.object({ password: z.string().min(1), code: z.string().max(8).default('') })); return disable('user', ctx.user.id, b.password, b.code, ctx); });
/** POST { mfaToken, code } — público: segundo passo do login. */
export const POST = route(null, async (ctx) => {
  const b = await json(ctx.req, z.object({ mfaToken: z.string().min(10), code: z.string().min(6).max(8) }));
  await rateLimit(`mfa:${ctx.ip ?? 'sem-ip'}`, RATE_RULES.mfa);
  const id = await readMfaToken(b.mfaToken, 'user');
  if (!(await checkCode('user', id, b.code))) { await audit(null, { action: 'LOGIN_FAILED', resource: 'auth', resourceId: id, after: { reason: 'BAD_MFA', ip: ctx.ip } }); throw unauthorized('Código inválido'); }
  const user = await runAsPlatform(() => prisma.user.findFirst({ where: { id, isActive: true, deletedAt: null } }));
  if (!user) throw unauthorized();
  return { ok: true, user: await finishLogin(user, ctx) };
});
