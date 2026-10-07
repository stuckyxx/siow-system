import { revokeSession } from '@/server/auth';
import { route } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/auth/logout — revoga a sessão do cookie de refresh e limpa cookies. */
export const POST = route(null, async (ctx) => {
  await revokeSession(ctx.req);
  return { ok: true };
});
