import { route } from '@/server/http';
import { revealSecret } from '@/server/services/webhooks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST — devolve o segredo em claro (auditado) para configurar a validação no destino. */
export const POST = route(['integrations.manage'], async (ctx) => revealSecret(ctx, ctx.params['id']!));
