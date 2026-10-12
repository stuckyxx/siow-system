import { route } from '@/server/http';
import { list } from '@/server/services/integrations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/integracoes — catálogo com estado por organização (segredos mascarados). */
export const GET = route(['integrations.manage'], async () => list());
