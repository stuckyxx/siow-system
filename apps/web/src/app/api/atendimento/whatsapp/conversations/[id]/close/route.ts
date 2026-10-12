import { z } from 'zod';
import { json, route } from '@/server/http';
import { close } from '@/server/services/whatsapp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = route(['tickets.write'], async (ctx) => close(ctx, ctx.params['id']!, (await json(ctx.req, z.object({ resolveTicket: z.boolean().default(true) }))).resolveTicket));
