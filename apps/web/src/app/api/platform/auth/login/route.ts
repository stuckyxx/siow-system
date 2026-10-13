import { platformLoginSchema } from '@siow/shared';
import { platformJson, platformLogin, platformRoute } from '@/server/platform-auth';
import { RATE_RULES, rateLimit, rateLimitReset } from '@/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/platform/auth/login — superadmin da plataforma (PlatformAdmin). Define cookie HttpOnly siow_platform. */
export const POST = platformRoute(async (ctx) => {
  const b = await platformJson(ctx.req, platformLoginSchema);
  const keys = [`plogin:${ctx.ip ?? 'sem-ip'}`, `plogin:${b.email.toLowerCase()}`];
  for (const k of keys) await rateLimit(k, RATE_RULES.platformLogin);
  const out = await platformLogin(b.email, b.password, ctx);
  for (const k of keys) await rateLimitReset(k);
  if ('mfaRequired' in out) return { ok: false, mfaRequired: true, mfaToken: out.mfaToken };
  return { ok: true, admin: out };
}, { auth: false });
