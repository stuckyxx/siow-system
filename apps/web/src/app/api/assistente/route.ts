/**
 * Assistente virtual (Fase 12). POST executa um turno do agente em nome do usuário logado;
 * GET informa se está configurado. Qualquer usuário autenticado pode usar — as permissões
 * valem em cada ação, pois o agente opera pela própria API.
 */
import { z } from 'zod';
import { HttpError, json, route } from '@/server/http';
import * as assistant from '@/server/services/assistant';
import { rateLimit } from '@/server/rate-limit';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(20_000) })).min(1).max(60),
  approvals: z.array(z.object({ token: z.string().max(64), method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']), path: z.string().max(400), body: z.unknown().optional(), reason: z.string().max(200) })).max(10).optional(),
});

export const GET = route([], async () => ({ configured: assistant.isConfigured(), model: assistant.modelName() }));

export const POST = route([], async (ctx) => {
  if (ctx.req.headers.get('x-siow-assistant')) throw new HttpError(403, 'O assistente não pode chamar a si mesmo.');
  await rateLimit(`assistant:${ctx.user.id}`, { limit: 60, windowMs: 60 * 60 * 1000 });
  const body = await json(ctx.req, bodySchema);
  return assistant.run(ctx, body);
});
