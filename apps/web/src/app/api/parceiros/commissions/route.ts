import { commissionListFilterSchema } from '@siow/shared';
import { parseQuery, route } from '@/server/http';
import { list } from '@/server/services/commissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/parceiros/commissions?partnerId&status&entityId&year&month — comissões paginadas com totais. */
export const GET = route(['partners.read'], async (ctx) => list(parseQuery(ctx.query, commissionListFilterSchema)));
