import { platformUpdateOrganizationSchema } from '@siow/shared';
import { platformJson, platformRoute } from '@/server/platform-auth';
import { getOrganization, removeOrganization, updateOrganization } from '@/server/services/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = platformRoute(async (ctx) => getOrganization(ctx.params['id']!));
export const PATCH = platformRoute(async (ctx) => updateOrganization(ctx, ctx.params['id']!, await platformJson(ctx.req, platformUpdateOrganizationSchema)));
export const DELETE = platformRoute(async (ctx) => removeOrganization(ctx, ctx.params['id']!));
