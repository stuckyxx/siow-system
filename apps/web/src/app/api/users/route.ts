import { createUserSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { create, list } from '@/server/services/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/users — lista com permissões efetivas/extras/revogadas. */
export const GET = route(['users.manage'], async () => list());

/** POST /api/users — cria usuário (obriga troca de senha no primeiro acesso). */
export const POST = route(['users.manage'], async (ctx) => create(ctx, await json(ctx.req, createUserSchema)));
