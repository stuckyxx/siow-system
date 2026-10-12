import { route } from '@/server/http';
import { ensureDefault, list } from '@/server/services/crm/pipelines';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/comercial/pipelines — funis da organização (garante o padrão). */
export const GET = route(['crm.read'], async () => { await ensureDefault(); return list(); });
