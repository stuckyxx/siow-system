import { updateEntitySchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { get, softDelete, update } from '@/server/services/entities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/financeiro/entities/[id] — detalhe com fontes, contratos (+aditivos) e overview. */
export const GET = route(['entities.read'], async (ctx) => get(ctx.params['id']!));

/** PATCH /api/financeiro/entities/[id] */
export const PATCH = route(['entities.write'], async (ctx) => update(ctx, ctx.params['id']!, await json(ctx.req, updateEntitySchema)));

/** DELETE /api/financeiro/entities/[id] — exclusão lógica. */
export const DELETE = route(['entities.write'], async (ctx) => {
  await softDelete(ctx, ctx.params['id']!);
  return { ok: true };
});
