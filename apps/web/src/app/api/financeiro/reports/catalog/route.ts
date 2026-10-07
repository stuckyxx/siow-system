import { route } from '@/server/http';
import { catalog } from '@/server/services/reports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/financeiro/reports/catalog — [{ key, label }] */
export const GET = route(['reports.read'], async () => catalog());
