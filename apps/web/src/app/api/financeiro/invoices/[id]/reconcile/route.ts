import { reconcileInvoiceSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { reconcile } from '@/server/services/invoices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/financeiro/invoices/[id]/reconcile — confirma status de nota que precisa de verificação. */
export const POST = route(['invoices.reconcile'], async (ctx) => reconcile(ctx, ctx.params['id']!, await json(ctx.req, reconcileInvoiceSchema)));
