import { ticketTaskSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { addTask } from '@/server/services/tickets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST — tarefa de acompanhamento ligada ao chamado (agenda única, módulo ATENDIMENTO). */
export const POST = route(['tickets.write', 'tasks.manage'], async (ctx) => addTask(ctx, ctx.params['id']!, await json(ctx.req, ticketTaskSchema)));
