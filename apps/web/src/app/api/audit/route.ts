import { parseQuery, route } from '@/server/http';
import { auditFilterSchema, auditList } from '@/server/services/system';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/audit — paginado; filtros userId, resource, resourceId, action, from, to. */
export const GET = route(['audit.read'], async (ctx) => auditList(parseQuery(ctx.query, auditFilterSchema)));
