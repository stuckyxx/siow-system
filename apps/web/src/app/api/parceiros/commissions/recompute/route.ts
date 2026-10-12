import { route } from '@/server/http';
import { recompute } from '@/server/services/commissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST — recálculo manual (idempotente) das comissões da organização. */
export const POST = route(['partners.manage'], async () => recompute());
