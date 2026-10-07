import { cronRoute } from '@/server/cron';
import { syncBatch } from '@/server/services/sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/sync — chamado pelo Vercel Cron (vercel.json) ou pelo GitHub Actions
 * com `Authorization: Bearer ${CRON_SECRET}`. Sincroniza as fontes mais antigas dentro
 * do orçamento (SYNC_BUDGET_MS) e devolve { processed, skipped, remaining, … }.
 * Fontes com circuito aberto são puladas (SKIPPED) na sincronização agendada.
 */
export const GET = cronRoute(async (req) => {
  const budget = Number(req.nextUrl.searchParams.get('budgetMs') ?? '') || undefined;
  const { runs: _runs, ...counts } = await syncBatch({ trigger: 'SCHEDULED', budgetMs: budget });
  return counts;
});
