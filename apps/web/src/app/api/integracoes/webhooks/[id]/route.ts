import { z } from 'zod';
import { json, route } from '@/server/http';
import { remove, upsert } from '@/server/services/webhooks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ name: z.string().min(2).max(120), url: z.string().url().max(500), events: z.array(z.string()).min(1), isActive: z.boolean().optional(), secret: z.string().max(200).optional().nullable() });
export const PUT = route(['integrations.manage'], async (ctx) => upsert(ctx, ctx.params['id']!, await json(ctx.req, schema)));
export const DELETE = route(['integrations.manage'], async (ctx) => { await remove(ctx, ctx.params['id']!); return { ok: true }; });
