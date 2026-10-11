import { issuanceDeadlineFilterSchema } from '@siow/shared';
import { parseQuery, route } from '@/server/http';
import { deadlines } from '@/server/services/alarms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/financeiro/alarms/deadlines?entityId=&days= — prazos de emissão calculados (atrasados, a vencer, próximos, emitidos). */
export const GET = route(['entities.read'], async (ctx) => {
  const f = parseQuery(ctx.query, issuanceDeadlineFilterSchema);
  return deadlines({ entityId: f.entityId, days: f.days });
});
