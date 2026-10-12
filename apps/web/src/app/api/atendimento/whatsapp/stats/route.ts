import { route } from '@/server/http';
import { stats } from '@/server/services/whatsapp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = route(['tickets.read'], async (ctx) => stats(ctx.user.id));
