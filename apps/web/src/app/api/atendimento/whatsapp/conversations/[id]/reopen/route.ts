import { route } from '@/server/http';
import { reopen } from '@/server/services/whatsapp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = route(['tickets.write'], async (ctx) => reopen(ctx, ctx.params['id']!));
