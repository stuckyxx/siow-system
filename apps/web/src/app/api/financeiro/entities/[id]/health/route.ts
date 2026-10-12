import { route } from '@/server/http';
import { getHealth } from '@/server/services/health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/financeiro/entities/[id]/health — saúde do cliente com os fatores. */
export const GET = route(['entities.read'], async (ctx) => getHealth(ctx.params['id']!));
