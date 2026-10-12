import { route } from '@/server/http';
import { deliveries } from '@/server/services/webhooks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(['integrations.manage'], async (ctx) => deliveries(ctx.params['id']!, Number(ctx.query['page'] ?? 1)));
