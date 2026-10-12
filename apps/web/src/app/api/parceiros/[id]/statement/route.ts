import { route } from '@/server/http';
import { statement } from '@/server/services/partners';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/parceiros/:id/statement — extrato do parceiro. */
export const GET = route(['partners.read'], async (ctx) => statement(ctx.params['id']!));
