import { z } from 'zod';
import { json, route } from '@/server/http';
import { assign } from '@/server/services/collections';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/financeiro/collections/invoice/[invoiceId]/assign — { assigneeUserId | null } */
export const POST = route(['collections.manage'], async (ctx) => {
  const body = await json(ctx.req, z.object({ assigneeUserId: z.string().uuid().nullable() }));
  return assign(ctx, ctx.params['invoiceId']!, body.assigneeUserId);
});
