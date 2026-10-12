import { route } from '@/server/http';
import { ping } from '@/server/services/webhooks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export const POST = route(['integrations.manage'], async (ctx) => ping(ctx, ctx.params['id']!));
