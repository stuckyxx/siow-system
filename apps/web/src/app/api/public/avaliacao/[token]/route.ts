import { ticketRatingSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { rate, ratingInfo } from '@/server/services/tickets';
import { RATE_RULES, rateLimit } from '@/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Público (link enviado ao cliente após a resolução). GET — dados do chamado. POST — nota 1–5 e comentário (uma única vez). */
export const GET = route(null, async (ctx) => ratingInfo(ctx.params['token']!));
export const POST = route(null, async (ctx) => { await rateLimit(`avaliacao:${ctx.ip ?? 'sem-ip'}`, RATE_RULES.publicWrite); return rate(ctx.params['token']!, await json(ctx.req, ticketRatingSchema)); });
