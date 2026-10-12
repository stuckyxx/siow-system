import { winOpportunitySchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { win } from '@/server/services/crm/opportunities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/comercial/opportunities/:id/win */
export const POST = route(['crm.write'], async (ctx) => win(ctx, ctx.params['id']!, await json(ctx.req, winOpportunitySchema)));
