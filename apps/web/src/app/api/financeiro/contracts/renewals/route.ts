import { renewalListFilterSchema } from '@siow/shared';
import { parseQuery, route } from '@/server/http';
import { list } from '@/server/services/renewals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/financeiro/contracts/renewals?status&entityId — renovações abertas/decididas. */
export const GET = route(['contracts.read'], async (ctx) => list(parseQuery(ctx.query, renewalListFilterSchema)));
