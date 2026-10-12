import { cronRoute, forEachOrganization } from '@/server/cron';
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
  // Uma organização por vez, repartindo o orçamento de tempo; o lote só processa fontes "vencidas".
  const results = await forEachOrganization(async () => {
    const { runs: _runs, ...counts } = await syncBatch({ trigger: 'SCHEDULED', budgetMs: budget });
    return counts;
  });
  const slugs = Object.keys(results);
  const total = Object.values(results).reduce((a, c) => ({ processed: a.processed + c.processed, skipped: a.skipped + c.skipped, remaining: a.remaining + c.remaining, succeeded: a.succeeded + c.succeeded, failed: a.failed + c.failed }), { processed: 0, skipped: 0, remaining: 0, succeeded: 0, failed: 0 });
  return slugs.length === 1 ? results[slugs[0]!] : { organizations: results, ...total };
});
