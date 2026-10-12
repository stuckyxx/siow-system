import { updateProposalStatusSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { setStatus } from '@/server/services/crm/proposals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST — enviada / aceita / recusada / rascunho. */
export const POST = route(['crm.write'], async (ctx) => setStatus(ctx, ctx.params['id']!, await json(ctx.req, updateProposalStatusSchema)));
