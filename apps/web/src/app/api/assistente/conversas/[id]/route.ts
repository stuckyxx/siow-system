/** GET/DELETE /api/assistente/conversas/[id] — uma conversa do usuário logado (mensagens completas) / exclusão lógica. */
import { route } from '@/server/http';
import { deleteConversation, getConversation } from '@/server/services/assistant';

export const dynamic = 'force-dynamic';
export const GET = route([], async (ctx) => getConversation(ctx.user.id, ctx.params['id']!));
export const DELETE = route([], async (ctx) => { await deleteConversation(ctx, ctx.params['id']!); });
