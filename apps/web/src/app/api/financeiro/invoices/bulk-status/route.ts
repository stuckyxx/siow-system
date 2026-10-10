import { bulkInvoiceStatusSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { bulkStatus } from '@/server/services/invoices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** POST /api/financeiro/invoices/bulk-status — marca uma ou várias notas como pagas/pendentes (manual, com justificativa). */
export const POST = route(['invoices.override'], async (ctx) => bulkStatus(ctx, await json(ctx.req, bulkInvoiceStatusSchema)));
