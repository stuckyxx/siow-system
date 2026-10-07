import { updateContractSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { get, softDelete, update } from '@/server/services/contracts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/financeiro/contracts/[id] — detalhe com entidade, aditivos e documentos. */
export const GET = route(['contracts.read'], async (ctx) => get(ctx.params['id']!));

/** PATCH /api/financeiro/contracts/[id] */
export const PATCH = route(['contracts.write'], async (ctx) => update(ctx, ctx.params['id']!, await json(ctx.req, updateContractSchema)));

/** DELETE /api/financeiro/contracts/[id] — exclusão lógica (remove também os aditivos). */
export const DELETE = route(['contracts.write'], async (ctx) => {
  await softDelete(ctx, ctx.params['id']!);
  return { ok: true };
});
