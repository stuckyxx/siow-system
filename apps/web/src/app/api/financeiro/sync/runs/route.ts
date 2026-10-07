import { syncRunListFilterSchema } from '@siow/shared';
import { parseQuery, route } from '@/server/http';
import { listRuns } from '@/server/services/sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/financeiro/sync/runs — execuções paginadas (filtros: entityId, status). */
export const GET = route(['sync.read'], async (ctx) => listRuns(parseQuery(ctx.query, syncRunListFilterSchema)));
