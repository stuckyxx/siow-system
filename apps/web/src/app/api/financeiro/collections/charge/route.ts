import { z } from 'zod';
import { COLLECTION_STATUSES, sendMessageSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { registerAttempt } from '@/server/services/collections';
import { send } from '@/server/services/messaging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cobrança via mensagem: envia (ou prepara envio manual) e registra a tentativa no caso da nota. */
const chargeSchema = sendMessageSchema.extend({
  invoiceId: z.string().uuid(),
  resultingStatus: z.enum(COLLECTION_STATUSES).default('SENT'),
  nextActionAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  nextActionNote: z.string().max(1000).optional().nullable(),
});

/** POST /api/financeiro/collections/charge — devolve { message, manualLink, sent, case }. */
export const POST = route(['collections.manage'], async (ctx) => {
  const body = await json(ctx.req, chargeSchema);
  const { resultingStatus, nextActionAt, nextActionNote, ...msg } = body;
  const result = await send(ctx, { ...msg, invoiceId: body.invoiceId });
  const status = result.sent ? resultingStatus : result.message.status === 'MANUAL_PENDING' ? 'SCHEDULED' : resultingStatus;
  const c = await registerAttempt(
    ctx,
    body.invoiceId,
    { channel: body.channel, contactId: body.contactId, message: body.body, resultingStatus: status, nextActionAt: nextActionAt ?? null, nextActionNote: nextActionNote ?? null },
    result.message.id,
  );
  return { ...result, case: c };
});
