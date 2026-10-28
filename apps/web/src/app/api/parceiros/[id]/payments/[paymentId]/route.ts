import { route } from '@/server/http';
import { removePayment } from '@/server/services/partners';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** DELETE /api/parceiros/:id/payments/:paymentId — remove um pagamento lançado. */
export const DELETE = route(['partners.manage'], async (ctx) => removePayment(ctx, ctx.params['id']!, ctx.params['paymentId']!));
