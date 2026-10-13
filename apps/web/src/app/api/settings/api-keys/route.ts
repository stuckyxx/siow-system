import { apiKeyCreateSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { create, list } from '@/server/services/api-keys';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(['settings.manage'], async () => list());
export const POST = route(['settings.manage'], async (ctx) => create(ctx, await json(ctx.req, apiKeyCreateSchema)));
