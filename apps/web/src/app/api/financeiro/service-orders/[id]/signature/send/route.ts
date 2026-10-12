import { z } from 'zod';
import { json, route } from '@/server/http';
import { sendForSignature } from '@/server/services/service-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({ signers: z.array(z.object({ name: z.string().min(2).max(160), email: z.string().email(), role: z.string().max(80).optional().nullable() })).min(1).max(10), deadlineDays: z.coerce.number().int().min(1).max(90).optional().nullable() });
/** POST — envia a OS para assinatura eletrônica no provedor configurado. */
export const POST = route(['service_orders.manage'], async (ctx) => sendForSignature(ctx, ctx.params['id']!, await json(ctx.req, schema)));
