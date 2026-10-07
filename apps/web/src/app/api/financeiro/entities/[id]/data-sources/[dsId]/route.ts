import { updateDataSourceSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { removeDataSource, updateDataSource } from '@/server/services/entities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** PATCH /api/financeiro/entities/[id]/data-sources/[dsId] — também zera o circuit breaker. */
export const PATCH = route(['entities.write'], async (ctx) => updateDataSource(ctx, ctx.params['id']!, ctx.params['dsId']!, await json(ctx.req, updateDataSourceSchema)));

/** DELETE /api/financeiro/entities/[id]/data-sources/[dsId] — exclusão lógica. */
export const DELETE = route(['entities.write'], async (ctx) => {
  await removeDataSource(ctx, ctx.params['id']!, ctx.params['dsId']!);
  return { ok: true };
});
