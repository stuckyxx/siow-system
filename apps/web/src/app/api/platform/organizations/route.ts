import { platformCreateOrganizationSchema } from '@siow/shared';
import { platformJson, platformRoute } from '@/server/platform-auth';
import { createOrganization, listOrganizations } from '@/server/services/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** GET — organizações (com assinatura, contagens e faturas em aberto). POST — cria organização + papéis + administrador + assinatura. */
export const GET = platformRoute(async (ctx) => listOrganizations({ includeRemoved: ctx.query['removidas'] === '1' }));
export const POST = platformRoute(async (ctx) => createOrganization(ctx, await platformJson(ctx.req, platformCreateOrganizationSchema)));
