import { campaignSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { create, list } from '@/server/services/campaigns';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET — campanhas. POST — cria campanha e resolve o público (destinatários pendentes). */
export const GET = route(['tickets.read'], async () => list());
export const POST = route(['tickets.manage'], async (ctx) => create(ctx, await json(ctx.req, campaignSchema)));
