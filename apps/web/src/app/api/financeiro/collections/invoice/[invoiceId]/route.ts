import { route } from '@/server/http';
import { ensureCase } from '@/server/services/collections';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/financeiro/collections/invoice/[invoiceId] — caso de cobrança da nota (criado se não existir). */
export const GET = route(['collections.read'], async (ctx) => ensureCase(ctx.params['invoiceId']!));
