import { route } from '@/server/http';
import { mustChangePassword } from '@/server/services/auth';
import { resolveAccess } from '@/server/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/auth/me — usuário autenticado (CurrentUser + mustChangePassword + licenciamento da organização). */
export const GET = route([], async (ctx) => ({ ...ctx.user, access: await resolveAccess(ctx.user.organizationId), mustChangePassword: await mustChangePassword(ctx.user.id) }));
