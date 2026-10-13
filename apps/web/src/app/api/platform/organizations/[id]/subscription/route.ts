import { subscriptionUpsertSchema } from '@siow/shared';
import { platformJson, platformRoute } from '@/server/platform-auth';
import { upsertSubscription } from '@/server/services/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PUT = platformRoute(async (ctx) => upsertSubscription(ctx, ctx.params['id']!, await platformJson(ctx.req, subscriptionUpsertSchema)));
