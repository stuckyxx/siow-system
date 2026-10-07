import { route } from '@/server/http';
import { syncEntityNow } from '@/server/services/sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** POST /api/financeiro/sync/entities/[id] — sincroniza agora (inline) todas as fontes ativas da entidade; devolve as execuções (SyncRun[]). */
export const POST = route(['sync.run'], async (ctx) => syncEntityNow(ctx, ctx.params['id']!));
