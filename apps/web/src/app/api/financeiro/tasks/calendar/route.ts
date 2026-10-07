import { z } from 'zod';
import { isoDate } from '@siow/shared';
import { parseQuery, route } from '@/server/http';
import { calendar } from '@/server/services/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const calendarSchema = z.object({ from: isoDate, to: isoDate, assigneeUserId: z.string().uuid().optional(), entityId: z.string().uuid().optional() });

/** GET /api/financeiro/tasks/calendar?from&to — tarefas agrupadas por dia. */
export const GET = route(['tasks.read'], async (ctx) => {
  const q = parseQuery(ctx.query, calendarSchema);
  return calendar(q.from, q.to, q.assigneeUserId, q.entityId);
});
