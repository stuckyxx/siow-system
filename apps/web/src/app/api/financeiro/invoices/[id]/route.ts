import { z } from 'zod';
import { json, route } from '@/server/http';
import { get, softDelete } from '@/server/services/invoices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/financeiro/invoices/[id] — detalhe com documentos, histórico (eventos), conflitos e cobrança. */
export const GET = route(['invoices.read'], async (ctx) => get(ctx.params['id']!));

/** DELETE /api/financeiro/invoices/[id] — exclusão lógica; corpo { justification } (>= 10 caracteres). */
export const DELETE = route(['invoices.override'], async (ctx) => {
  const body = await json(ctx.req, z.object({ justification: z.string().min(10) }));
  await softDelete(ctx, ctx.params['id']!, body.justification);
  return { ok: true };
});
