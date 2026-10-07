import { route } from '@/server/http';
import { permissions } from '@/server/services/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/permissions — catálogo de permissões. */
export const GET = route(['users.manage'], async () => permissions());
