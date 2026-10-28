import { partnerPaymentSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { addPayment, payments } from '@/server/services/partners';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/parceiros/:id/payments — pagamentos e resumo por competência; POST registra um pagamento. */
export const GET = route(['partners.read'], async (ctx) => payments(ctx.params['id']!));
export const POST = route(['partners.manage'], async (ctx) => addPayment(ctx, ctx.params['id']!, await json(ctx.req, partnerPaymentSchema)));
