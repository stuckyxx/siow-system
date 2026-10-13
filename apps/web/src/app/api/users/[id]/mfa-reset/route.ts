import { route } from '@/server/http';
import { adminReset } from '@/server/services/mfa';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST — administrador desliga o 2FA de um usuário que perdeu o autenticador (auditado). */
export const POST = route(['users.manage'], async (ctx) => adminReset(ctx, ctx.params['id']!));
