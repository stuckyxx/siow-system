import { route } from '@/server/http';
import { mustChangePassword } from '@/server/services/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/auth/me — usuário autenticado (CurrentUser + mustChangePassword). */
export const GET = route([], async (ctx) => ({ ...ctx.user, mustChangePassword: await mustChangePassword(ctx.user.id) }));
