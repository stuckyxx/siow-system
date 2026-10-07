import { createManualInvoiceSchema, invoiceListFilterSchema } from '@siow/shared';
import { json, parseQuery, route } from '@/server/http';
import { createManual, list } from '@/server/services/invoices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/financeiro/invoices — listagem paginada com totais. */
export const GET = route(['invoices.read'], async (ctx) => list(parseQuery(ctx.query, invoiceListFilterSchema)));

/** POST /api/financeiro/invoices — nota manual (exige justificativa). */
export const POST = route(['invoices.override'], async (ctx) => createManual(ctx, await json(ctx.req, createManualInvoiceSchema)));
