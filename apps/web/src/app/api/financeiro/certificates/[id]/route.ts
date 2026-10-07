import { route } from '@/server/http';
import { get } from '@/server/services/certificates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/financeiro/certificates/[id] — certidão com todas as versões. */
export const GET = route(['certificates.read'], async (ctx) => get(ctx.params['id']!));
