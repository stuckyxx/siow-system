import { importLinkSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { importLink } from '@/server/services/entities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** POST /api/financeiro/entities/import-link — { url } do Portal do Cliente (Assesi ou Adois, entidade ou parceiro): cadastra a(s) entidade(s). */
export const POST = route(['entities.write'], async (ctx) => {
  const { url } = await json(ctx.req, importLinkSchema);
  return importLink(ctx, url);
});
