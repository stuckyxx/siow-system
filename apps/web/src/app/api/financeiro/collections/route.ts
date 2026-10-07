import { z } from 'zod';
import { COLLECTION_STATUSES, boolParam } from '@siow/shared';
import { parseQuery, route } from '@/server/http';
import { list } from '@/server/services/collections';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const listSchema = z.object({
  entityId: z.string().uuid().optional(),
  status: z.enum(COLLECTION_STATUSES).optional(),
  assigneeUserId: z.string().uuid().optional(),
  dueOnly: boolParam,
});

/** GET /api/financeiro/collections — casos de cobrança (filtros: entidade, status, responsável, dueOnly). */
export const GET = route(['collections.read'], async (ctx) => list(parseQuery(ctx.query, listSchema)));
