import { route } from '@/server/http';
import { permissions } from '@/server/services/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/users/permissions — catálogo de permissões (compatível; ver também /api/permissions). */
export const GET = route(['users.manage'], async () => permissions());
