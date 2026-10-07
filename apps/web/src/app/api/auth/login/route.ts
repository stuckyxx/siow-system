import { loginSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { login } from '@/server/services/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/auth/login — público. Define cookies HttpOnly de acesso/refresh. */
export const POST = route(null, async (ctx) => {
  const body = await json(ctx.req, loginSchema);
  const user = await login(body.email, body.password, ctx);
  return { ok: true, user };
});
