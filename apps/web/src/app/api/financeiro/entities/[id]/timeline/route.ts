import { route } from '@/server/http';
import { timeline } from '@/server/services/timeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/financeiro/entities/[id]/timeline — linha do tempo 360º (somente leitura). */
export const GET = route(['entities.read'], async (ctx) => timeline(ctx.params['id']!));
