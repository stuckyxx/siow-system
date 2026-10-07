import { route } from '@/server/http';
import { ledger } from '@/server/services/contracts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/financeiro/contracts/[id]/ledger — conta corrente do contrato. */
export const GET = route(['contracts.read'], async (ctx) => ledger(ctx.params['id']!));
