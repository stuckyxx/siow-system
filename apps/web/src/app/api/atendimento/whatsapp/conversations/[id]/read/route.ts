import { route } from '@/server/http';
import { markRead } from '@/server/services/whatsapp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = route(['tickets.read'], async (ctx) => { await markRead(ctx.params['id']!); return { ok: true }; });
