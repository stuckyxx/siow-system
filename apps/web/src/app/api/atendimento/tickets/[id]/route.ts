import { updateTicketSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { get, softDelete, update } from '@/server/services/tickets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(['tickets.read'], async (ctx) => get(ctx.params['id']!, ctx.req.nextUrl.origin));
export const PATCH = route(['tickets.write'], async (ctx) => update(ctx, ctx.params['id']!, await json(ctx.req, updateTicketSchema)));
export const DELETE = route(['tickets.manage'], async (ctx) => { await softDelete(ctx, ctx.params['id']!); return { ok: true }; });
