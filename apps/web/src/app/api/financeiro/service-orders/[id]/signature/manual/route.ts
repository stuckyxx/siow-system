import { registerManualSignatureSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { registerManualSignature } from '@/server/services/service-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/financeiro/service-orders/[id]/signature/manual — registra assinatura via upload da OS assinada. */
export const POST = route(['service_orders.manage'], async (ctx) => registerManualSignature(ctx, ctx.params['id']!, await json(ctx.req, registerManualSignatureSchema)));
