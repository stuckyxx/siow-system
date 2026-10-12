import { z } from 'zod';
import { json, route } from '@/server/http';
import { linkContact } from '@/server/services/whatsapp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = route(['tickets.write'], async (ctx) => linkContact(ctx, ctx.params['id']!, (await json(ctx.req, z.object({ contactId: z.string().uuid() }))).contactId));
