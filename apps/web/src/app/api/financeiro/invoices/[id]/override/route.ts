import { invoiceOverrideSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { override } from '@/server/services/invoices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** PATCH /api/financeiro/invoices/[id]/override — alteração manual protegida (justificativa obrigatória). */
export const PATCH = route(['invoices.override'], async (ctx) => override(ctx, ctx.params['id']!, await json(ctx.req, invoiceOverrideSchema)));
