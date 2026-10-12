import { z } from 'zod';
import { json, route } from '@/server/http';
import { WEBHOOK_EVENTS, list, upsert } from '@/server/services/webhooks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const webhookSchema = z.object({ name: z.string().min(2).max(120), url: z.string().url().max(500), events: z.array(z.string()).min(1), isActive: z.boolean().optional(), secret: z.string().max(200).optional().nullable() });
/** GET — webhooks da organização (+ eventos disponíveis). POST — cria (segredo gerado se não informado). */
export const GET = route(['integrations.manage'], async () => ({ items: await list(), events: WEBHOOK_EVENTS }));
export const POST = route(['integrations.manage'], async (ctx) => upsert(ctx, null, await json(ctx.req, webhookSchema)));
