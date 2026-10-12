import { goalSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { create, list } from '@/server/services/crm/goals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/comercial/goals[?activeOn=YYYY-MM-DD] — metas com apuração calculada. */
export const GET = route(['crm.read'], async (ctx) => list(ctx.query['activeOn'] || undefined));
export const POST = route(['crm.manage'], async (ctx) => create(ctx, await json(ctx.req, goalSchema)));
