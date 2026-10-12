import { z } from 'zod';
import { json, route } from '@/server/http';
import { sendTemplate } from '@/server/services/whatsapp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;
/** POST { name, language, params[] } — envia modelo aprovado (fora da janela de 24h). */
export const POST = route(['tickets.write'], async (ctx) => { const b = await json(ctx.req, z.object({ name: z.string().min(1).max(120), language: z.string().min(2).max(10), params: z.array(z.string().max(500)).default([]) })); return sendTemplate(ctx, ctx.params['id']!, b.name, b.language, b.params); });
