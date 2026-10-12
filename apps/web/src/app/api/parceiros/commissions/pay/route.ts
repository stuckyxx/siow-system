import { payCommissionsSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { pay } from '@/server/services/commissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST — registra pagamento ao parceiro das comissões "a pagar" selecionadas. */
export const POST = route(['partners.manage'], async (ctx) => pay(ctx, await json(ctx.req, payCommissionsSchema)));
