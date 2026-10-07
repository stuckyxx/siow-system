import { route } from '@/server/http';
import { notifications } from '@/server/services/system';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/notifications?unread=true — do usuário + globais (userId null). */
export const GET = route([], async (ctx) => notifications(ctx.user.id, ctx.query['unread'] === 'true'));
