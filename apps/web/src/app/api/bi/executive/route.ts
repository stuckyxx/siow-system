import { executiveFilterSchema } from '@siow/shared';
import { parseQuery, route } from '@/server/http';
import { executive } from '@/server/services/bi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** GET /api/bi/executive?from&to&uf&municipality&entityId&responsibleUserId&partnerId — painel executivo consolidado (somente leitura). */
export const GET = route(['dashboard.read'], async (ctx) => executive(parseQuery(ctx.query, executiveFilterSchema)));
