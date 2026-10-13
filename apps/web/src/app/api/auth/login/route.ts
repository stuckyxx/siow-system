import { loginSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { login } from '@/server/services/auth';
import { RATE_RULES, rateLimit, rateLimitReset } from '@/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/auth/login — público. Define cookies HttpOnly de acesso/refresh. */
export const POST = route(null, async (ctx) => {
  const body = await json(ctx.req, loginSchema);
  const key = `login:${ctx.ip ?? 'sem-ip'}`;
  rateLimit(key, RATE_RULES.login);
  const user = await login(body.email, body.password, ctx);
  rateLimitReset(key);
  return { ok: true, user };
});
