import { updateUserSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { get, update } from '@/server/services/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/users/[id] */
export const GET = route(['users.manage'], async (ctx) => get(ctx.params['id']!));

/** PATCH /api/users/[id] — dados, papéis, senha e ativar/desativar ({ isActive }). */
export const PATCH = route(['users.manage'], async (ctx) => update(ctx, ctx.params['id']!, await json(ctx.req, updateUserSchema)));
