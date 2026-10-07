import { route } from '@/server/http';
import { resetPassword } from '@/server/services/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/users/[id]/reset-password → { temporaryPassword } */
export const POST = route(['users.manage'], async (ctx) => resetPassword(ctx, ctx.params['id']!));
