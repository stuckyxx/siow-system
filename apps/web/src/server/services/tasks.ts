/**
 * Agenda financeira geral e por entidade (spec §14–16).
 */
import type { Prisma } from '@siow/db';
import { isoToDate, todayIso } from '@siow/shared';
import type { z } from 'zod';
import type { createTaskSchema, taskListFilterSchema, updateTaskSchema } from '@siow/shared';
import { prisma } from '../db.js';
import { audit } from '../audit.js';
import { notFound, type Ctx } from '../http.js';

const include = {
  entity: { select: { id: true, name: true, shortName: true, type: true } },
  contract: { select: { id: true, number: true } },
  invoice: { select: { id: true, number: true, competenceMonth: true, competenceYear: true, amount: true } },
  serviceOrder: { select: { id: true, competenceMonth: true, competenceYear: true, status: true } },
  assignee: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.FinancialTaskInclude;

export async function list(f: z.infer<typeof taskListFilterSchema>) {
  const where: Prisma.FinancialTaskWhereInput = { deletedAt: null, entityId: f.entityId, status: f.status, type: f.type, priority: f.priority };
  if (f.assigneeUserId === 'unassigned') where.assigneeUserId = null;
  else if (f.assigneeUserId) where.assigneeUserId = f.assigneeUserId;
  if (f.dueFrom || f.dueTo) where.dueDate = { gte: f.dueFrom ? isoToDate(f.dueFrom) : undefined, lte: f.dueTo ? isoToDate(f.dueTo) : undefined };
  if (f.overdue) {
    where.dueDate = { lt: isoToDate(todayIso()) };
    where.status = { in: ['PENDING', 'IN_PROGRESS'] };
  }
  const [items, total] = await Promise.all([
    prisma.financialTask.findMany({ where, include, orderBy: [{ dueDate: f.sortDir === 'asc' ? 'asc' : 'desc' }, { priority: 'desc' }], skip: (f.page - 1) * f.pageSize, take: f.pageSize }),
    prisma.financialTask.count({ where }),
  ]);
  return { items, total, page: f.page, pageSize: f.pageSize };
}

/** Visão de agenda: tarefas agrupadas por dia num intervalo. */
export async function calendar(from: string, to: string, assigneeUserId?: string, entityId?: string) {
  const items = await prisma.financialTask.findMany({
    where: { deletedAt: null, dueDate: { gte: isoToDate(from), lte: isoToDate(to) }, assigneeUserId, entityId },
    include,
    orderBy: [{ dueDate: 'asc' }, { dueTime: 'asc' }],
  });
  const days: Record<string, typeof items> = {};
  for (const t of items) {
    const key = t.dueDate.toISOString().slice(0, 10);
    (days[key] ??= []).push(t);
  }
  return days;
}

export async function get(id: string) {
  const t = await prisma.financialTask.findFirst({ where: { id, deletedAt: null }, include: { ...include, events: { orderBy: { createdAt: 'desc' }, include: { user: { select: { id: true, name: true } } } } } });
  if (!t) throw notFound('Tarefa não encontrada');
  return t;
}

export async function create(ctx: Ctx, input: z.infer<typeof createTaskSchema>) {
  const t = await prisma.financialTask.create({
    data: {
      ...input,
      dueDate: isoToDate(input.dueDate),
      createdByUserId: ctx.user.id,
      events: { create: { action: 'CREATED', userId: ctx.user.id, toValue: input.assigneeUserId ?? null } },
    },
    include,
  });
  await audit(ctx, { action: 'CREATE', resource: 'task', resourceId: t.id, after: t });
  return t;
}

export async function update(ctx: Ctx, id: string, input: z.infer<typeof updateTaskSchema>) {
  const before = await get(id);
  const events: Prisma.TaskEventUncheckedCreateInput[] = [];
  if (input.status && input.status !== before.status) events.push({ taskId: id, userId: ctx.user.id, action: 'STATUS_CHANGED', fromValue: before.status, toValue: input.status });
  if (input.assigneeUserId !== undefined && input.assigneeUserId !== before.assigneeUserId) events.push({ taskId: id, userId: ctx.user.id, action: 'REASSIGNED', fromValue: before.assigneeUserId, toValue: input.assigneeUserId });
  if (input.dueDate && input.dueDate !== before.dueDate.toISOString().slice(0, 10)) events.push({ taskId: id, userId: ctx.user.id, action: 'RESCHEDULED', fromValue: before.dueDate.toISOString().slice(0, 10), toValue: input.dueDate });
  const t = await prisma.financialTask.update({
    where: { id },
    data: {
      ...input,
      dueDate: input.dueDate ? isoToDate(input.dueDate) : undefined,
      completedAt: input.status === 'DONE' ? new Date() : input.status ? null : undefined,
      events: events.length ? { create: events.map(({ taskId: _t, ...e }) => e) } : undefined,
    },
    include,
  });
  await audit(ctx, { action: 'UPDATE', resource: 'task', resourceId: id, before: { status: before.status, assigneeUserId: before.assigneeUserId, dueDate: before.dueDate }, after: { status: t.status, assigneeUserId: t.assigneeUserId, dueDate: t.dueDate } });
  return t;
}

export async function comment(ctx: Ctx, id: string, note: string) {
  await get(id);
  return prisma.taskEvent.create({ data: { taskId: id, userId: ctx.user.id, action: 'COMMENT', note } });
}

export async function softDelete(ctx: Ctx, id: string): Promise<void> {
  const before = await get(id);
  await prisma.financialTask.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit(ctx, { action: 'SOFT_DELETE', resource: 'task', resourceId: id, before: { title: before.title } });
}
