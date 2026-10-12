import { route } from '@/server/http';
import { retry } from '@/server/services/webhooks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export const POST = route(['integrations.manage'], async (ctx) => { await retry(ctx, ctx.params['id']!); return { ok: true }; });
