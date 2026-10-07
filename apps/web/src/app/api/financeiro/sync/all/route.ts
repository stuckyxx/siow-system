import { route } from '@/server/http';
import { syncAllNow } from '@/server/services/sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/financeiro/sync/all — sincroniza todas as fontes dentro do orçamento de tempo (SYNC_BUDGET_MS),
 * da mais antiga para a mais recente. Devolve { processed, skipped, remaining, succeeded, failed, durationMs, certificates }.
 * O que ficar em `remaining` é retomado pelo cron (/api/cron/sync) ou por nova chamada.
 */
export const POST = route(['sync.run'], async (ctx) => syncAllNow(ctx));
