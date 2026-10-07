import { registerCollectionAttemptSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { registerAttempt } from '@/server/services/collections';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/financeiro/collections/invoice/[invoiceId]/attempts — registra uma tentativa de cobrança manual. */
export const POST = route(['collections.manage'], async (ctx) => registerAttempt(ctx, ctx.params['invoiceId']!, await json(ctx.req, registerCollectionAttemptSchema)));
