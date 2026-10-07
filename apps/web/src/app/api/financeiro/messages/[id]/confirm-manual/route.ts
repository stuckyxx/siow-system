import { route } from '@/server/http';
import { confirmManual } from '@/server/services/messaging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/financeiro/messages/[id]/confirm-manual — usuário confirma envio manual (wa.me/mailto). */
export const POST = route(['collections.manage'], async (ctx) => confirmManual(ctx, ctx.params['id']!));
