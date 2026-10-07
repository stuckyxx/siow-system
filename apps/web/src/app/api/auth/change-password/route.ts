import { changePasswordSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { changePassword } from '@/server/services/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/auth/change-password — autenticado. Mantém a sessão atual e revoga as demais. */
export const POST = route([], async (ctx) => {
  const body = await json(ctx.req, changePasswordSchema);
  await changePassword(ctx, body.currentPassword, body.newPassword);
  return { ok: true };
});
