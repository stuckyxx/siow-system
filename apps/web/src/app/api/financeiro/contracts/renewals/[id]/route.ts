import { renewalDecisionSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { decide } from '@/server/services/renewals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/financeiro/contracts/renewals/:id — decisão humana: RENEWED | NOT_RENEWED | CANCELLED. */
export const POST = route(['contracts.write'], async (ctx) => decide(ctx, ctx.params['id']!, await json(ctx.req, renewalDecisionSchema)));
