import { updateTenderSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { get, softDelete, update } from '@/server/services/tenders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(['tenders.read'], async (ctx) => get(ctx.params['id']!));
export const PATCH = route(['tenders.write'], async (ctx) => update(ctx, ctx.params['id']!, await json(ctx.req, updateTenderSchema)));
export const DELETE = route(['tenders.write'], async (ctx) => { await softDelete(ctx, ctx.params['id']!); return { ok: true }; });
