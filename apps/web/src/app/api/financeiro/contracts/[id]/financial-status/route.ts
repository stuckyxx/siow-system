import { route } from '@/server/http';
import { financialStatus } from '@/server/services/contracts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/financeiro/contracts/:id/financial-status — previsto × faturado × recebido × pendente (sempre separados). */
export const GET = route(['contracts.read'], async (ctx) => financialStatus(ctx.params['id']!));
