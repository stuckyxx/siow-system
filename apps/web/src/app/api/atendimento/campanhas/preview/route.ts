import { z } from 'zod';
import { campaignAudienceSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { preview } from '@/server/services/campaigns';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ audience: campaignAudienceSchema, channel: z.enum(['WHATSAPP', 'EMAIL']) });
/** POST — prévia do público (total, entidades, amostra, provedor configurado). */
export const POST = route(['tickets.manage'], async (ctx) => { const b = await json(ctx.req, schema); return preview(b.audience, b.channel); });
