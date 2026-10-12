import { moveOpportunitySchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { move } from '@/server/services/crm/opportunities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/comercial/opportunities/:id/move */
export const POST = route(['crm.write'], async (ctx) => move(ctx, ctx.params['id']!, await json(ctx.req, moveOpportunitySchema)));
