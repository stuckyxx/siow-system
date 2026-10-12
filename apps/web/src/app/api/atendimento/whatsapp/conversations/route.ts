import { z } from 'zod';
import { parseQuery, route } from '@/server/http';
import { list } from '@/server/services/whatsapp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ filter: z.enum(['all', 'mine', 'unassigned', 'unread', 'closed']).default('all'), q: z.string().max(80).optional() });
/** GET /api/atendimento/whatsapp/conversations?filter&q — caixa de entrada. */
export const GET = route(['tickets.read'], async (ctx) => list(parseQuery(ctx.query, schema), ctx.user.id));
