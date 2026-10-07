import { route } from '@/server/http';
import { overview } from '@/server/services/sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/financeiro/sync/overview — fontes, execuções das últimas 24h, em andamento e agenda do cron. */
export const GET = route(['sync.read'], async () => overview());
