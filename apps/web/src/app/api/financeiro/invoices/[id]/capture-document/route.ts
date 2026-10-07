import { route } from '@/server/http';
import { captureDocument } from '@/server/services/invoices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/financeiro/invoices/[id]/capture-document — baixa o PDF da nota do portal e armazena (síncrono). */
export const POST = route(['documents.write'], async (ctx) => captureDocument(ctx, ctx.params['id']!));
