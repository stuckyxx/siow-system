import { z } from 'zod';
import { CONTRACT_STATUSES, createContractSchema } from '@siow/shared';
import { json, parseQuery, route } from '@/server/http';
import { create, list } from '@/server/services/contracts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const listSchema = z.object({
  entityId: z.string().uuid().optional(),
  status: z.enum(CONTRACT_STATUSES).optional(),
  expiringDays: z.coerce.number().int().min(1).max(3650).optional(),
  q: z.string().max(100).optional(),
});

/** GET /api/financeiro/contracts?entityId=&status=&expiringDays=&q= */
export const GET = route(['contracts.read'], async (ctx) => list(parseQuery(ctx.query, listSchema)));

/** POST /api/financeiro/contracts */
export const POST = route(['contracts.write'], async (ctx) => create(ctx, await json(ctx.req, createContractSchema)));
