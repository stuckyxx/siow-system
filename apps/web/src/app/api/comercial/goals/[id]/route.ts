import { goalSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { remove, update } from '@/server/services/crm/goals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PUT = route(['crm.manage'], async (ctx) => update(ctx, ctx.params['id']!, await json(ctx.req, goalSchema)));
export const DELETE = route(['crm.manage'], async (ctx) => { await remove(ctx, ctx.params['id']!); return { ok: true }; });
