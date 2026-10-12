import { createOpportunitySchema, opportunityListFilterSchema } from '@siow/shared';
import { json, parseQuery, route } from '@/server/http';
import { create, list } from '@/server/services/crm/opportunities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/comercial/opportunities — lista paginada (q, entidade, funil, etapa, situação, responsável, UF, origem, paradas, fechamento). */
export const GET = route(['crm.read'], async (ctx) => list(parseQuery(ctx.query, opportunityListFilterSchema)));
/** POST — nova oportunidade (começa na primeira etapa em andamento do funil padrão, salvo indicação). */
export const POST = route(['crm.write'], async (ctx) => create(ctx, await json(ctx.req, createOpportunitySchema)));
