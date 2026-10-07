import { route } from '@/server/http';
import { settings } from '@/server/services/system';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/settings */
export const GET = route(['settings.manage'], async () => settings());
