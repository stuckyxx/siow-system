import { route } from '@/server/http';
import { markRead } from '@/server/services/system';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** PATCH /api/notifications/[id]/read */
export const PATCH = route([], async (ctx) => {
  await markRead(ctx.user.id, ctx.params['id']!);
  return { ok: true };
});
