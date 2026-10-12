import { loseOpportunitySchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { lose } from '@/server/services/crm/opportunities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/comercial/opportunities/:id/lose */
export const POST = route(['crm.write'], async (ctx) => lose(ctx, ctx.params['id']!, await json(ctx.req, loseOpportunitySchema)));
