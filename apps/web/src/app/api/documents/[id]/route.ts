import { route } from '@/server/http';
import { get, softDelete } from '@/server/services/documents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/documents/[id] */
export const GET = route(['documents.read'], async (ctx) => get(ctx.params['id']!));

/** DELETE /api/documents/[id] — exclusão lógica. */
export const DELETE = route(['documents.write'], async (ctx) => {
  await softDelete(ctx, ctx.params['id']!);
  return { ok: true };
});
