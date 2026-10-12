import { tenderCompetitorSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { addCompetitor } from '@/server/services/tenders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(['tenders.write'], async (ctx) => addCompetitor(ctx, ctx.params['id']!, await json(ctx.req, tenderCompetitorSchema)));
