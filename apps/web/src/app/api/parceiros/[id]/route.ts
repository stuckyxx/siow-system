import { updatePartnerSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { get, remove, update } from '@/server/services/partners';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(['partners.read'], async (ctx) => get(ctx.params['id']!));
export const PATCH = route(['partners.manage'], async (ctx) => update(ctx, ctx.params['id']!, await json(ctx.req, updatePartnerSchema)));
export const DELETE = route(['partners.manage'], async (ctx) => { await remove(ctx, ctx.params['id']!); return { ok: true }; });
