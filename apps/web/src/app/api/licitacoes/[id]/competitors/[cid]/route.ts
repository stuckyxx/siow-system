import { route } from '@/server/http';
import { removeCompetitor } from '@/server/services/tenders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const DELETE = route(['tenders.write'], async (ctx) => { await removeCompetitor(ctx.params['id']!, ctx.params['cid']!); return { ok: true }; });
