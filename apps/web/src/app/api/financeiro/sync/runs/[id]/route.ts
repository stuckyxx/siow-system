import { route } from '@/server/http';
import { getRun } from '@/server/services/sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/financeiro/sync/runs/[id] — execução com eventos de notas e conflitos gerados. */
export const GET = route(['sync.read'], async (ctx) => getRun(ctx.params['id']!));
