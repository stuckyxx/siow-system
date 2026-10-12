import { route } from '@/server/http';
import { get } from '@/server/services/whatsapp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = route(['tickets.read'], async (ctx) => get(ctx.params['id']!));
