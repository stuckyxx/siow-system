import { route } from '@/server/http';
import { get } from '@/server/services/crm/proposals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(['crm.read'], async (ctx) => get(ctx.params['id']!));
