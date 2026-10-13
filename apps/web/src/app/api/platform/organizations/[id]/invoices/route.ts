import { z } from 'zod';
import { platformJson, platformRoute } from '@/server/platform-auth';
import { generateInvoice, listInvoices } from '@/server/services/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = platformRoute(async (ctx) => listInvoices({ organizationId: ctx.params['id']! }));
/** POST { period: "YYYY-MM" } — gera (idempotente) a fatura do período. */
export const POST = platformRoute(async (ctx) => { const b = await platformJson(ctx.req, z.object({ period: z.string().regex(/^\d{4}-\d{2}$/) })); return generateInvoice(ctx.params['id']!, b.period, ctx); });
