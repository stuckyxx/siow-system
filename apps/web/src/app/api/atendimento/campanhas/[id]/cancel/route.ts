import { route } from '@/server/http';
import { cancel } from '@/server/services/campaigns';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(['tickets.manage'], async (ctx) => { await cancel(ctx, ctx.params['id']!); return { ok: true }; });
