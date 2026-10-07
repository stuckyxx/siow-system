import { z } from 'zod';
import { SERVICE_ORDER_STATUSES, createServiceOrderSchema } from '@siow/shared';
import { json, parseQuery, route } from '@/server/http';
import { create, list } from '@/server/services/service-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const listSchema = z.object({
  entityId: z.string().uuid().optional(),
  contractId: z.string().uuid().optional(),
  status: z.enum(SERVICE_ORDER_STATUSES).optional(),
  year: z.coerce.number().int().optional(),
});

/** GET /api/financeiro/service-orders — lista (filtros: entidade, contrato, status, exercício). */
export const GET = route(['service_orders.read'], async (ctx) => list(parseQuery(ctx.query, listSchema)));

/** POST /api/financeiro/service-orders — nova OS. */
export const POST = route(['service_orders.manage'], async (ctx) => create(ctx, await json(ctx.req, createServiceOrderSchema)));
