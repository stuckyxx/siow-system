import { z } from 'zod';
import { json, route } from '@/server/http';
import { startWithContact } from '@/server/services/whatsapp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** POST { contactId } — abre (ou reabre) a conversa com um contato cadastrado. */
export const POST = route(['tickets.write'], async (ctx) => startWithContact(ctx, (await json(ctx.req, z.object({ contactId: z.string().uuid() }))).contactId));
