import { catalogItemSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { create, list } from '@/server/services/crm/catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(['crm.read'], async (ctx) => list(ctx.query['active'] === 'true'));
export const POST = route(['crm.manage'], async (ctx) => create(ctx, await json(ctx.req, catalogItemSchema)));
