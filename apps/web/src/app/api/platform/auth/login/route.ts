import { platformLoginSchema } from '@siow/shared';
import { platformJson, platformLogin, platformRoute } from '@/server/platform-auth';
import { RATE_RULES, rateLimit, rateLimitReset } from '@/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/platform/auth/login — superadmin da plataforma (PlatformAdmin). Define cookie HttpOnly siow_platform. */
export const POST = platformRoute(async (ctx) => {
  const b = await platformJson(ctx.req, platformLoginSchema);
  const keys = [`plogin:${ctx.ip ?? 'sem-ip'}`, `plogin:${b.email.toLowerCase()}`];
  for (const k of keys) rateLimit(k, RATE_RULES.platformLogin);
  const admin = await platformLogin(b.email, b.password, ctx);
  for (const k of keys) rateLimitReset(k);
  return { ok: true, admin };
}, { auth: false });
