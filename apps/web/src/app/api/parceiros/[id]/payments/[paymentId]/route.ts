import { updatePartnerPaymentSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { removePayment, updatePayment } from '@/server/services/partners';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** PATCH edita um pagamento lançado (competência, valor, data, observação); DELETE remove. */
export const PATCH = route(['partners.manage'], async (ctx) => updatePayment(ctx, ctx.params['id']!, ctx.params['paymentId']!, await json(ctx.req, updatePartnerPaymentSchema)));
export const DELETE = route(['partners.manage'], async (ctx) => removePayment(ctx, ctx.params['id']!, ctx.params['paymentId']!));
