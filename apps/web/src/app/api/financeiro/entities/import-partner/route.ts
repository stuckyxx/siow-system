import { importPartnerSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { importPartner } from '@/server/services/entities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** POST /api/financeiro/entities/import-partner — { url } de parceiro da Adois (t=2): cadastra uma entidade por município. */
export const POST = route(['entities.write'], async (ctx) => {
  const { url } = await json(ctx.req, importPartnerSchema);
  return importPartner(ctx, url);
});
