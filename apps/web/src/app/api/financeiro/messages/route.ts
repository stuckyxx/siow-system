import { z } from 'zod';
import { parseQuery, route } from '@/server/http';
import { listByEntity } from '@/server/services/messaging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/financeiro/messages?entityId — mensagens enviadas/preparadas da entidade (até 200). */
export const GET = route(['collections.read'], async (ctx) => {
  const q = parseQuery(ctx.query, z.object({ entityId: z.string().uuid() }));
  return listByEntity(q.entityId);
});
