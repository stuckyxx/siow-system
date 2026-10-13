/** GET /api/assistente/conversas — conversas do usuário logado com o Assistente (mais recentes primeiro). */
import { route } from '@/server/http';
import { listConversations } from '@/server/services/assistant';

export const dynamic = 'force-dynamic';
export const GET = route([], async (ctx) => listConversations(ctx.user.id));
