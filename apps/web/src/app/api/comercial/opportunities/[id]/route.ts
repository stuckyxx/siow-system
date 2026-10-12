import { updateOpportunitySchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { get, softDelete, update } from '@/server/services/crm/opportunities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(['crm.read'], async (ctx) => get(ctx.params['id']!));
export const PATCH = route(['crm.write'], async (ctx) => update(ctx, ctx.params['id']!, await json(ctx.req, updateOpportunitySchema)));
export const DELETE = route(['crm.write'], async (ctx) => { await softDelete(ctx, ctx.params['id']!); return { ok: true }; });
