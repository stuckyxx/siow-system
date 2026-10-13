import { z } from 'zod';
import { platformJson, platformRoute } from '@/server/platform-auth';
import { cancelInvoice } from '@/server/services/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = platformRoute(async (ctx) => { const b = await platformJson(ctx.req, z.object({ reason: z.string().min(3).max(300) })); return cancelInvoice(ctx, ctx.params['id']!, b.reason); });
