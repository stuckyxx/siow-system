import { planUpsertSchema } from '@siow/shared';
import { platformJson, platformRoute } from '@/server/platform-auth';
import { listPlans, upsertPlan } from '@/server/services/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = platformRoute(async () => listPlans());
export const PUT = platformRoute(async (ctx) => upsertPlan(ctx, await platformJson(ctx.req, planUpsertSchema)));
