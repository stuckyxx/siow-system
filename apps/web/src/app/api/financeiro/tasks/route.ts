import { createTaskSchema, taskListFilterSchema } from '@siow/shared';
import { json, parseQuery, route } from '@/server/http';
import { create, list } from '@/server/services/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/financeiro/tasks — agenda financeira paginada (filtros: entidade, responsável, status, tipo, prioridade, vencimento, atrasadas). */
export const GET = route(['tasks.read'], async (ctx) => list(parseQuery(ctx.query, taskListFilterSchema)));

/** POST /api/financeiro/tasks — nova tarefa. */
export const POST = route(['tasks.manage'], async (ctx) => create(ctx, await json(ctx.req, createTaskSchema)));
