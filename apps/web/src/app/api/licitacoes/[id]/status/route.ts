import { tenderStatusSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { setStatus } from '@/server/services/tenders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST — muda a situação (histórico; reflete na oportunidade ligada). */
export const POST = route(['tenders.write'], async (ctx) => setStatus(ctx, ctx.params['id']!, await json(ctx.req, tenderStatusSchema)));
