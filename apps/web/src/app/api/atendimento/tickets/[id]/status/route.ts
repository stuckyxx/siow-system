import { ticketStatusSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { setStatus } from '@/server/services/tickets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST — muda a situação (RESOLVED gera o link de avaliação; CLOSED encerra). */
export const POST = route(['tickets.write'], async (ctx) => setStatus(ctx, ctx.params['id']!, await json(ctx.req, ticketStatusSchema)));
