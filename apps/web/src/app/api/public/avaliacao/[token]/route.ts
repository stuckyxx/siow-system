import { ticketRatingSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { rate, ratingInfo } from '@/server/services/tickets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Público (link enviado ao cliente após a resolução). GET — dados do chamado. POST — nota 1–5 e comentário (uma única vez). */
export const GET = route(null, async (ctx) => ratingInfo(ctx.params['token']!));
export const POST = route(null, async (ctx) => rate(ctx.params['token']!, await json(ctx.req, ticketRatingSchema)));
