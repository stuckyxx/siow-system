/**
 * Dashboard comercial: funil (quantidade/valor por etapa), ganhos × perdidos no período, conversão,
 * previsão por mês de fechamento (esperado × ponderado), desempenho por responsável, motivos de perda, metas e paradas.
 * Todos os números são CALCULADOS a partir das oportunidades (não são receita confirmada — isso é do Financeiro).
 */
import { Prisma } from '@siow/db';
import { daysBetween, isoToDate, todayIso, type CrmDashboard } from '@siow/shared';
import type { z } from 'zod';
import type { crmDashboardFilterSchema } from '@siow/shared';
import { prisma } from '../../db.js';
import { ensureDefault } from './pipelines.js';
import { isStalled, stalledDaysDefault } from './opportunities.js';
import { list as listGoals } from './goals.js';

const total = (o: { totalAmount: Prisma.Decimal | null; monthlyAmount: Prisma.Decimal | null; oneTimeAmount: Prisma.Decimal | null; termMonths: number | null }): Prisma.Decimal =>
  o.totalAmount ?? (o.monthlyAmount ? o.monthlyAmount.mul(o.termMonths ?? 12) : new Prisma.Decimal(0)).add(o.oneTimeAmount ?? 0);

export async function crmDashboard(f: z.infer<typeof crmDashboardFilterSchema>): Promise<CrmDashboard> {
  const today = todayIso();
  const from = f.from ?? `${today.slice(0, 7)}-01`;
  const to = f.to ?? today;
  const pipeline = f.pipelineId ? { id: f.pipelineId } : await ensureDefault();
  const fallback = await stalledDaysDefault();
  const baseWhere: Prisma.OpportunityWhereInput = { deletedAt: null, pipelineId: pipeline.id, ownerUserId: f.ownerUserId, entity: f.uf ? { uf: f.uf.toUpperCase() } : undefined };
  const periodRange = { gte: isoToDate(from), lte: new Date(isoToDate(to).getTime() + 86_399_000) };
  const [open, won, lost, stages, tasksDue, tasksOverdue, goals] = await Promise.all([
    prisma.opportunity.findMany({ where: { ...baseWhere, status: 'OPEN' }, include: { stage: true, entity: { select: { name: true, shortName: true } }, owner: { select: { id: true, name: true } } } }),
    prisma.opportunity.findMany({ where: { ...baseWhere, status: 'WON', wonAt: periodRange }, include: { owner: { select: { id: true, name: true } } } }),
    prisma.opportunity.findMany({ where: { ...baseWhere, status: 'LOST', lostAt: periodRange }, include: { owner: { select: { id: true, name: true } } } }),
    prisma.pipelineStage.findMany({ where: { pipelineId: pipeline.id }, orderBy: { position: 'asc' } }),
    prisma.financialTask.count({ where: { deletedAt: null, module: 'COMERCIAL', status: { in: ['PENDING', 'IN_PROGRESS'] }, dueDate: { gte: isoToDate(today), lte: isoToDate(today) }, assigneeUserId: f.ownerUserId } }),
    prisma.financialTask.count({ where: { deletedAt: null, module: 'COMERCIAL', status: { in: ['PENDING', 'IN_PROGRESS'] }, dueDate: { lt: isoToDate(today) }, assigneeUserId: f.ownerUserId } }),
    listGoals(today),
  ]);
  const openAmount = open.reduce((a, o) => a.add(total(o)), new Prisma.Decimal(0));
  const weighted = open.reduce((a, o) => a.add(total(o).mul(o.probability ?? o.stage.probability).div(100)), new Prisma.Decimal(0));
  const wonAmount = won.reduce((a, o) => a.add(total(o)), new Prisma.Decimal(0));
  const closed = won.length + lost.length;
  const cycles = won.filter((o) => o.wonAt).map((o) => daysBetween(o.createdAt.toISOString().slice(0, 10), o.wonAt!.toISOString().slice(0, 10)));
  const stalledOpen = open.filter((o) => isStalled(o, fallback, today));

  const funnel = stages.map((s) => {
    const its = s.kind === 'OPEN' ? open.filter((o) => o.stageId === s.id) : s.kind === 'WON' ? won : lost;
    return { stageId: s.id, name: s.name, kind: s.kind, count: its.length, amount: its.reduce((a, o) => a.add(total(o)), new Prisma.Decimal(0)).toFixed(2), stalled: s.kind === 'OPEN' ? its.filter((o) => isStalled({ ...o, stage: s }, fallback, today)).length : 0 };
  });

  const byOwnerMap = new Map<string, CrmDashboard['byOwner'][number] & { wonAmountDec: Prisma.Decimal }>();
  const ownerKey = (o: { owner: { id: string; name: string } | null }) => o.owner?.id ?? 'none';
  const ensure = (o: { owner: { id: string; name: string } | null }) => { const k = ownerKey(o); let e = byOwnerMap.get(k); if (!e) { e = { userId: o.owner?.id ?? null, name: o.owner?.name ?? 'Sem responsável', open: 0, won: 0, wonAmount: '0.00', lost: 0, wonAmountDec: new Prisma.Decimal(0) }; byOwnerMap.set(k, e); } return e; };
  for (const o of open) ensure(o).open += 1;
  for (const o of won) { const e = ensure(o); e.won += 1; e.wonAmountDec = e.wonAmountDec.add(total(o)); }
  for (const o of lost) ensure(o).lost += 1;
  const byOwner = [...byOwnerMap.values()].map((e) => ({ userId: e.userId, name: e.name, open: e.open, won: e.won, wonAmount: e.wonAmountDec.toFixed(2), lost: e.lost })).sort((a, b) => Number(b.wonAmount) - Number(a.wonAmount) || b.open - a.open);

  const reasons = new Map<string, number>();
  for (const o of lost) reasons.set(o.lostReason ?? 'Não informado', (reasons.get(o.lostReason ?? 'Não informado') ?? 0) + 1);
  const lossReasons = [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);

  const months = new Map<string, { expected: Prisma.Decimal; weighted: Prisma.Decimal; count: number }>();
  for (const o of open) {
    const m = (o.expectedCloseDate ?? null)?.toISOString().slice(0, 7) ?? 'sem data';
    const e = months.get(m) ?? { expected: new Prisma.Decimal(0), weighted: new Prisma.Decimal(0), count: 0 };
    e.expected = e.expected.add(total(o)); e.weighted = e.weighted.add(total(o).mul(o.probability ?? o.stage.probability).div(100)); e.count += 1; months.set(m, e);
  }
  const forecast = [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, e]) => ({ month, expected: e.expected.toFixed(2), weighted: e.weighted.toFixed(2), count: e.count }));

  return {
    generatedAt: new Date().toISOString(), period: { from, to },
    cards: { open: open.length, openAmount: openAmount.toFixed(2), weightedAmount: weighted.toFixed(2), wonCount: won.length, wonAmount: wonAmount.toFixed(2), lostCount: lost.length, conversionRate: closed ? Math.round((won.length / closed) * 100) : null, stalled: stalledOpen.length, activitiesDue: tasksDue, activitiesOverdue: tasksOverdue, avgCycleDays: cycles.length ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length) : null },
    funnel, byOwner, lossReasons, forecast, goals,
    stalledList: stalledOpen.map((o) => ({ id: o.id, title: o.title, entityName: o.entity.shortName ?? o.entity.name, stageName: o.stage.name, daysInStage: daysBetween(o.stageEnteredAt.toISOString().slice(0, 10), today), ownerName: o.owner?.name ?? null })).sort((a, b) => b.daysInStage - a.daysInStage).slice(0, 20),
  };
}
