import { tenderListFilterSchema, tenderSchema } from '@siow/shared';
import { json, parseQuery, route } from '@/server/http';
import { create, list } from '@/server/services/tenders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/licitacoes?q&entityId&status&modality&uf&open&from&to — lista paginada. POST — nova licitação (checklist padrão a partir das certidões). */
export const GET = route(['tenders.read'], async (ctx) => list(parseQuery(ctx.query, tenderListFilterSchema)));
export const POST = route(['tenders.write'], async (ctx) => create(ctx, await json(ctx.req, tenderSchema)));
