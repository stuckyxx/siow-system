import { route } from '@/server/http';
import { markAllRead } from '@/server/services/system';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/notifications/read-all */
export const POST = route([], async (ctx) => {
  await markAllRead(ctx.user.id);
  return { ok: true };
});
