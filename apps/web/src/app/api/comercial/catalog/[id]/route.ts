import { updateCatalogItemSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { remove, update } from '@/server/services/crm/catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PATCH = route(['crm.manage'], async (ctx) => update(ctx, ctx.params['id']!, await json(ctx.req, updateCatalogItemSchema)));
export const DELETE = route(['crm.manage'], async (ctx) => { await remove(ctx, ctx.params['id']!); return { ok: true }; });
