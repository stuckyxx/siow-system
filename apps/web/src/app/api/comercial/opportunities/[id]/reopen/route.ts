import { reopenOpportunitySchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { reopen } from '@/server/services/crm/opportunities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/comercial/opportunities/:id/reopen */
export const POST = route(['crm.write'], async (ctx) => reopen(ctx, ctx.params['id']!, await json(ctx.req, reopenOpportunitySchema)));
