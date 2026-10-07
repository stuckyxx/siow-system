import { updateTaskSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { get, softDelete, update } from '@/server/services/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/financeiro/tasks/[id] — detalhe com histórico de eventos. */
export const GET = route(['tasks.read'], async (ctx) => get(ctx.params['id']!));

/** PATCH /api/financeiro/tasks/[id] — status, responsável, data, etc. */
export const PATCH = route(['tasks.manage'], async (ctx) => update(ctx, ctx.params['id']!, await json(ctx.req, updateTaskSchema)));

/** DELETE /api/financeiro/tasks/[id] — exclusão lógica. */
export const DELETE = route(['tasks.manage'], async (ctx) => {
  await softDelete(ctx, ctx.params['id']!);
  return { ok: true };
});
