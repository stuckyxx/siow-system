import { partnerSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { create, list } from '@/server/services/partners';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/parceiros?q= — parceiros com totais de comissão. POST — novo parceiro. */
export const GET = route(['partners.read'], async (ctx) => list(ctx.query['q'] || undefined));
export const POST = route(['partners.manage'], async (ctx) => create(ctx, await json(ctx.req, partnerSchema)));
