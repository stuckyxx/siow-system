import { z } from 'zod';
import { json, route } from '@/server/http';
import { sendText } from '@/server/services/whatsapp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;
/** POST { body } — envia texto (só dentro da janela de 24h). */
export const POST = route(['tickets.write'], async (ctx) => sendText(ctx, ctx.params['id']!, (await json(ctx.req, z.object({ body: z.string().min(1).max(4096) }))).body));
