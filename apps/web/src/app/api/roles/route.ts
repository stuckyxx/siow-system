import { route } from '@/server/http';
import { roles } from '@/server/services/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/roles — papéis com permissões. */
export const GET = route(['users.manage'], async () => roles());
