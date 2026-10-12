import { z } from 'zod';
import { json, route } from '@/server/http';
import { assign } from '@/server/services/whatsapp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = route(['tickets.write'], async (ctx) => assign(ctx, ctx.params['id']!, (await json(ctx.req, z.object({ assigneeUserId: z.string().uuid().nullable() }))).assigneeUserId));
