import { ticketInteractionSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { addInteraction } from '@/server/services/tickets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST — registra interação (nota, resposta, ligação, visita, reunião/ata); `sendVia` envia ao contato por WhatsApp/e-mail. */
export const POST = route(['tickets.write'], async (ctx) => addInteraction(ctx, ctx.params['id']!, await json(ctx.req, ticketInteractionSchema)));
