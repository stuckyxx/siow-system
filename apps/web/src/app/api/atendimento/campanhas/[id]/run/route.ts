import { route } from '@/server/http';
import { run } from '@/server/services/campaigns';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** POST — processa até 50 destinatários pendentes por chamada (idempotente). */
export const POST = route(['tickets.manage'], async (ctx) => run(ctx, ctx.params['id']!));
