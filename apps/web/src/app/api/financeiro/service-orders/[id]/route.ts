import { updateServiceOrderSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { get, update } from '@/server/services/service-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/financeiro/service-orders/[id] — detalhe com eventos, signatários e solicitações de assinatura. */
export const GET = route(['service_orders.read'], async (ctx) => get(ctx.params['id']!));

/** PATCH /api/financeiro/service-orders/[id] — status/datas/número/observações (+ note para o histórico). */
export const PATCH = route(['service_orders.manage'], async (ctx) => update(ctx, ctx.params['id']!, await json(ctx.req, updateServiceOrderSchema)));
