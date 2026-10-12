import { tenderDeadlineSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { addDeadline } from '@/server/services/tenders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(['tenders.write'], async (ctx) => addDeadline(ctx, ctx.params['id']!, await json(ctx.req, tenderDeadlineSchema)));
