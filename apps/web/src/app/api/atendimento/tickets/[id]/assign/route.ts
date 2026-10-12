import { ticketAssignSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { assign } from '@/server/services/tickets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST — atribui/remove responsável (OPEN → IN_PROGRESS ao atribuir). */
export const POST = route(['tickets.write'], async (ctx) => assign(ctx, ctx.params['id']!, await json(ctx.req, ticketAssignSchema)));
