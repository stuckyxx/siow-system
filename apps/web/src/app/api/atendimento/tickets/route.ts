import { ticketListFilterSchema, ticketSchema } from '@siow/shared';
import { json, parseQuery, route } from '@/server/http';
import { create, list } from '@/server/services/tickets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/atendimento/tickets?q&status&open&priority&type&assigneeUserId(me|unassigned|id)&entityId&slaBreached — lista. POST — abre chamado (SLA por prioridade). */
export const GET = route(['tickets.read'], async (ctx) => list(parseQuery(ctx.query, ticketListFilterSchema), ctx.user.id));
export const POST = route(['tickets.write'], async (ctx) => create(ctx, await json(ctx.req, ticketSchema)));
