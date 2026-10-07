import { route } from '@/server/http';
import { filterOptions } from '@/server/services/dashboard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/financeiro/dashboard/filter-options */
export const GET = route(['dashboard.read'], async () => filterOptions());
