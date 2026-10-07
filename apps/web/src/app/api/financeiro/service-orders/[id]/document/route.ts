import { z } from 'zod';
import { json, route } from '@/server/http';
import { attachDocument } from '@/server/services/service-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/financeiro/service-orders/[id]/document — { documentId } vincula o PDF da OS emitida. */
export const POST = route(['service_orders.manage'], async (ctx) => {
  const body = await json(ctx.req, z.object({ documentId: z.string().uuid() }));
  return attachDocument(ctx, ctx.params['id']!, body.documentId);
});
