import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@siow/db';
import { isoToDate, todayIso } from '@siow/shared';
import type { z } from 'zod';
import type { createTaskSchema, taskListFilterSchema, updateTaskSchema } from '@siow/shared';
import { AuditService } from '../../../common/audit/audit.service.js';
import type { RequestContext } from '../../../common/auth/decorators.js';
import { PrismaService } from '../../../common/prisma/prisma.service.js';

const include = {
  entity: { select: { id: true, name: true, shortName: true, type: true } },
  contract: { select: { id: true, number: true } },
  invoice: { select: { id: true, number: true, competenceMonth: true, competenceYear: true, amount: true } },
  serviceOrder: { select: { id: true, competenceMonth: true, competenceYear: true, status: true } },
  assignee: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.FinancialTaskInclude;

/** Agenda financeira geral e por entidade (spec §14–16). */
@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(f: z.infer<typeof taskListFilterSchema>) {
    const where: Prisma.FinancialTaskWhereInput = { deletedAt: null, entityId: f.entityId, status: f.status, type: f.type, priority: f.priority };
    if (f.assigneeUserId === 'unassigned') where.assigneeUserId = null;
    else if (f.assigneeUserId) where.assigneeUserId = f.assigneeUserId;
    if (f.dueFrom || f.dueTo) where.dueDate = { gte: f.dueFrom ? isoToDate(f.dueFrom) : undefined, lte: f.dueTo ? isoToDate(f.dueTo) : undefined };
    if (f.overdue) {
      where.dueDate = { lt: isoToDate(todayIso()) };
      where.status = { in: ['PENDING', 'IN_PROGRESS'] };
    }
    const [items, total] = await Promise.all([
      this.prisma.financialTask.findMany({ where, include, orderBy: [{ dueDate: f.sortDir === 'asc' ? 'asc' : 'desc' }, { priority: 'desc' }], skip: (f.page - 1) * f.pageSize, take: f.pageSize }),
      this.prisma.financialTask.count({ where }),
    ]);
    return { items, total, page: f.page, pageSize: f.pageSize };
  }

  /** Visão de agenda: tarefas agrupadas por dia num intervalo. */
  async calendar(from: string, to: string, assigneeUserId?: string, entityId?: string) {
    const items = await this.prisma.financialTask.findMany({
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

  async get(id: string) {
    const t = await this.prisma.financialTask.findFirst({ where: { id, deletedAt: null }, include: { ...include, events: { orderBy: { createdAt: 'desc' }, include: { user: { select: { id: true, name: true } } } } } });
    if (!t) throw new NotFoundException('Tarefa não encontrada');
    return t;
  }

  async create(ctx: RequestContext, input: z.infer<typeof createTaskSchema>) {
    const t = await this.prisma.financialTask.create({
      data: {
        ...input,
        dueDate: isoToDate(input.dueDate),
        createdByUserId: ctx.user.id,
        events: { create: { action: 'CREATED', userId: ctx.user.id, toValue: input.assigneeUserId ?? null } },
      },
      include,
    });
    await this.audit.log(ctx, { action: 'CREATE', resource: 'task', resourceId: t.id, after: t });
    return t;
  }

  async update(ctx: RequestContext, id: string, input: z.infer<typeof updateTaskSchema>) {
    const before = await this.get(id);
    const events: Prisma.TaskEventUncheckedCreateInput[] = [];
    if (input.status && input.status !== before.status) events.push({ taskId: id, userId: ctx.user.id, action: 'STATUS_CHANGED', fromValue: before.status, toValue: input.status });
    if (input.assigneeUserId !== undefined && input.assigneeUserId !== before.assigneeUserId) events.push({ taskId: id, userId: ctx.user.id, action: 'REASSIGNED', fromValue: before.assigneeUserId, toValue: input.assigneeUserId });
    if (input.dueDate && input.dueDate !== before.dueDate.toISOString().slice(0, 10)) events.push({ taskId: id, userId: ctx.user.id, action: 'RESCHEDULED', fromValue: before.dueDate.toISOString().slice(0, 10), toValue: input.dueDate });
    const t = await this.prisma.financialTask.update({
      where: { id },
      data: {
        ...input,
        dueDate: input.dueDate ? isoToDate(input.dueDate) : undefined,
        completedAt: input.status === 'DONE' ? new Date() : input.status ? null : undefined,
        events: events.length ? { create: events.map(({ taskId: _t, ...e }) => e) } : undefined,
      },
      include,
    });
    await this.audit.log(ctx, { action: 'UPDATE', resource: 'task', resourceId: id, before: { status: before.status, assigneeUserId: before.assigneeUserId, dueDate: before.dueDate }, after: { status: t.status, assigneeUserId: t.assigneeUserId, dueDate: t.dueDate } });
    return t;
  }

  async comment(ctx: RequestContext, id: string, note: string) {
    await this.get(id);
    return this.prisma.taskEvent.create({ data: { taskId: id, userId: ctx.user.id, action: 'COMMENT', note } });
  }

  async softDelete(ctx: RequestContext, id: string): Promise<void> {
    const before = await this.get(id);
    await this.prisma.financialTask.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log(ctx, { action: 'SOFT_DELETE', resource: 'task', resourceId: id, before: { title: before.title } });
  }
}
