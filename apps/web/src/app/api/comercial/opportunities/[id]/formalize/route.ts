import { formalizeOpportunitySchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { formalize } from '@/server/services/crm/opportunities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/comercial/opportunities/:id/formalize */
export const POST = route(['crm.write'], async (ctx) => formalize(ctx, ctx.params['id']!, await json(ctx.req, formalizeOpportunitySchema)));
