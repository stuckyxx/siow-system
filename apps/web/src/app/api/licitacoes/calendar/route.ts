import { z } from 'zod';
import { isoDate } from '@siow/shared';
import { parseQuery, route } from '@/server/http';
import { calendar } from '@/server/services/tenders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ from: isoDate, to: isoDate });
/** GET /api/licitacoes/calendar?from&to — prazos de licitações no intervalo. */
export const GET = route(['tenders.read'], async (ctx) => { const q = parseQuery(ctx.query, schema); return calendar(q.from, q.to); });
