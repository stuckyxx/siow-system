import { linkPartnerEntitiesSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { linkEntities } from '@/server/services/partners';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/parceiros/:id/link { entityIds, unlink } — vincula/desvincula entidades. */
export const POST = route(['partners.manage'], async (ctx) => linkEntities(ctx, ctx.params['id']!, await json(ctx.req, linkPartnerEntitiesSchema)));
