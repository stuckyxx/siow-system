import { z } from 'zod';
import { json, route } from '@/server/http';
import { comment } from '@/server/services/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/financeiro/tasks/[id]/comments — { note } */
export const POST = route(['tasks.manage'], async (ctx) => {
  const body = await json(ctx.req, z.object({ note: z.string().min(1).max(2000) }));
  return comment(ctx, ctx.params['id']!, body.note);
});
