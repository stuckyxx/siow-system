import { route } from '@/server/http';
import { roles } from '@/server/services/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/users/roles — papéis com permissões (compatível com o frontend atual; ver também /api/roles). */
export const GET = route(['users.manage'], async () => roles());
