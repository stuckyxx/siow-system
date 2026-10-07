import { createEntitySchema, entityListFilterSchema } from '@siow/shared';
import { json, parseQuery, route } from '@/server/http';
import { create, list } from '@/server/services/entities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/financeiro/entities — listagem paginada com indicadores financeiros. */
export const GET = route(['entities.read'], async (ctx) => list(parseQuery(ctx.query, entityListFilterSchema)));

/** POST /api/financeiro/entities */
export const POST = route(['entities.write'], async (ctx) => create(ctx, await json(ctx.req, createEntitySchema)));
