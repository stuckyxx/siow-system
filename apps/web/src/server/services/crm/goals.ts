/** Metas comerciais por período (individuais ou da equipe) com apuração calculada a partir das oportunidades/atividades. */
import { Prisma } from '@siow/db';
import { isoToDate, type GoalRow } from '@siow/shared';
import type { z } from 'zod';
import type { goalSchema } from '@siow/shared';
import { prisma } from '../../db.js';
import { currentOrgId } from '../../tenant.js';
import { audit } from '../../audit.js';
import { notFound, type Ctx } from '../../http.js';

type G = Prisma.GoalGetPayload<{ include: { user: { select: { name: true } } } }>;

async function achieved(g: G): Promise<Prisma.Decimal> {
  const range = { gte: g.periodStart, lte: new Date(g.periodEnd.getTime() + 86_399_000) };
  if (g.metric === 'ACTIVITIES') {
    const n = await prisma.financialTask.count({ where: { deletedAt: null, module: 'COMERCIAL', status: 'DONE', completedAt: range, assigneeUserId: g.userId ?? undefined } });
    return new Prisma.Decimal(n);
  }
  const won = await prisma.opportunity.findMany({ where: { deletedAt: null, status: 'WON', wonAt: range, ownerUserId: g.userId ?? undefined }, select: { totalAmount: true, monthlyAmount: true, oneTimeAmount: true, termMonths: true } });
  if (g.metric === 'WON_COUNT') return new Prisma.Decimal(won.length);
  return won.reduce((acc, o) => acc.add(o.totalAmount ?? (o.monthlyAmount ? o.monthlyAmount.mul(o.termMonths ?? 12) : new Prisma.Decimal(0)).add(o.oneTimeAmount ?? 0)), new Prisma.Decimal(0));
}

export async function toRow(g: G): Promise<GoalRow> {
  const a = await achieved(g);
  return { id: g.id, userId: g.userId, userName: g.user?.name ?? null, metric: g.metric, periodStart: g.periodStart.toISOString().slice(0, 10), periodEnd: g.periodEnd.toISOString().slice(0, 10), target: g.target.toFixed(2), label: g.label, achieved: a.toFixed(2), percent: g.target.gt(0) ? Math.min(999, Math.round(a.div(g.target).mul(100).toNumber())) : 0 };
}

export async function list(activeOn?: string): Promise<GoalRow[]> {
  const where: Prisma.GoalWhereInput = activeOn ? { periodStart: { lte: isoToDate(activeOn) }, periodEnd: { gte: isoToDate(activeOn) } } : {};
  const rows = await prisma.goal.findMany({ where, include: { user: { select: { name: true } } }, orderBy: [{ periodStart: 'desc' }, { userId: 'asc' }] });
  return Promise.all(rows.map(toRow));
}

export async function create(ctx: Ctx, input: z.infer<typeof goalSchema>): Promise<GoalRow> {
  const g = await prisma.goal.create({ data: { organizationId: currentOrgId(), userId: input.userId ?? null, metric: input.metric, periodStart: isoToDate(input.periodStart), periodEnd: isoToDate(input.periodEnd), target: new Prisma.Decimal(input.target), label: input.label ?? null }, include: { user: { select: { name: true } } } });
  await audit(ctx, { action: 'CREATE', resource: 'goal', resourceId: g.id, after: g });
  return toRow(g);
}

export async function update(ctx: Ctx, id: string, input: z.infer<typeof goalSchema>): Promise<GoalRow> {
  const before = await prisma.goal.findFirst({ where: { id } });
  if (!before) throw notFound('Meta não encontrada');
  const g = await prisma.goal.update({ where: { id }, data: { userId: input.userId ?? null, metric: input.metric, periodStart: isoToDate(input.periodStart), periodEnd: isoToDate(input.periodEnd), target: new Prisma.Decimal(input.target), label: input.label ?? null }, include: { user: { select: { name: true } } } });
  await audit(ctx, { action: 'UPDATE', resource: 'goal', resourceId: id, before, after: g });
  return toRow(g);
}

export async function remove(ctx: Ctx, id: string): Promise<void> {
  const before = await prisma.goal.findFirst({ where: { id } });
  if (!before) throw notFound('Meta não encontrada');
  await prisma.goal.delete({ where: { id } });
  await audit(ctx, { action: 'DELETE', resource: 'goal', resourceId: id, before });
}
