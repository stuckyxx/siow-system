/**
 * Relatórios e BI (Fase 7). Somente consulta: nada é gravado. Cada número declara sua natureza:
 *  - CONFIRMADO: fatos registrados (notas emitidas, recebimentos, contratos ativos, chamados, comissões pagas);
 *  - PROJEÇÃO: receita prevista por contrato (regra do Financeiro: última nota, senão valor do contrato) e funil ponderado;
 *  - CALCULADO: taxas, médias e índices derivados dos dois anteriores.
 * O Financeiro continua a fonte oficial dos valores; o CRM, das oportunidades; Licitações, dos processos.
 */
import { Prisma } from '@siow/db';
import { TICKET_OPEN_STATUSES, dateToIso, daysBetween, isoToDate, todayIso, toDecimalString, type ExecutiveDashboard } from '@siow/shared';
import type { z } from 'zod';
import type { executiveFilterSchema } from '@siow/shared';
import { prisma } from '../db.js';
import { forecast } from './dashboard.js';
import { list as listGoals } from './crm/goals.js';
import { band } from './health.js';

type F = z.infer<typeof executiveFilterSchema>;
const D = (v: Prisma.Decimal | number | null | undefined): number => Number(v ?? 0);
const money = (n: number): string => toDecimalString(n);
const oppTotal = (o: { totalAmount: Prisma.Decimal | null; monthlyAmount: Prisma.Decimal | null; oneTimeAmount: Prisma.Decimal | null; termMonths: number | null }): number => D(o.totalAmount) || D(o.monthlyAmount) * (o.termMonths ?? 12) + D(o.oneTimeAmount);
const pct = (num: number, den: number): number | null => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);
const avg = (xs: number[]): number | null => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

/** Filtro de entidade compartilhado por todos os blocos (escopo do painel). */
export function entityScope(f: Pick<F, 'uf' | 'municipality' | 'entityId' | 'responsibleUserId' | 'partnerId'>): Prisma.EntityWhereInput {
  return { deletedAt: null, id: f.entityId, uf: f.uf?.toUpperCase(), municipality: f.municipality ? { equals: f.municipality, mode: 'insensitive' } : undefined, responsibleUserId: f.responsibleUserId, partnerId: f.partnerId };
}
export function describeScope(f: Pick<F, 'uf' | 'municipality' | 'entityId' | 'responsibleUserId' | 'partnerId'>): string {
  const parts = [f.entityId ? 'entidade selecionada' : null, f.municipality ? `município ${f.municipality}` : null, f.uf ? `UF ${f.uf.toUpperCase()}` : null, f.responsibleUserId ? 'por responsável' : null, f.partnerId ? 'por parceiro' : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Toda a carteira';
}

export async function executive(f: F): Promise<ExecutiveDashboard> {
  const today = todayIso();
  const to = f.to ?? today;
  const from = f.from ?? `${to.slice(0, 4)}-01-01`;
  const fromD = isoToDate(from); const toD = new Date(isoToDate(to).getTime() + 86_399_000);
  const periodMonths = Math.max(1, (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1);
  const entity = entityScope(f);
  const inScope = { entity };
  const activeContract: Prisma.ContractWhereInput = { status: 'ACTIVE', deletedAt: null };
  const d90 = isoToDate(today); d90.setUTCDate(d90.getUTCDate() + 90);

  const [entities, contracts, invoices, fc, opps, goals, tenders, tickets, commissions, partners, renewals, draftContracts] = await Promise.all([
    prisma.entity.findMany({ where: entity, select: { id: true, name: true, shortName: true, type: true, uf: true, municipality: true, healthScore: true, contracts: { where: { deletedAt: null }, select: { status: true, startDate: true, endDate: true, terminatedAt: true, activatedAt: true, createdAt: true } }, _count: { select: { invoices: true } } } }),
    prisma.contract.findMany({ where: { ...activeContract, ...inScope }, select: { id: true, monthlyValue: true, endDate: true, entityId: true, entity: { select: { uf: true, municipality: true } } } }),
    prisma.invoice.findMany({ where: { deletedAt: null, status: { not: 'CANCELLED' }, ...inScope, OR: [{ issueDate: { gte: fromD, lte: toD } }, { issueDate: null, createdAt: { gte: fromD, lte: toD } }, { status: 'PENDING' }] }, select: { amount: true, paidAmount: true, status: true, issueDate: true, paidAt: true, competenceMonth: true, competenceYear: true, entityId: true, entity: { select: { uf: true, municipality: true } } } }),
    forecast({ entityId: f.entityId, uf: f.uf, municipality: f.municipality, responsibleUserId: f.responsibleUserId }),
    prisma.opportunity.findMany({ where: { deletedAt: null, ...inScope, OR: [{ status: 'OPEN' }, { wonAt: { gte: fromD, lte: toD } }, { lostAt: { gte: fromD, lte: toD } }] }, select: { status: true, totalAmount: true, monthlyAmount: true, oneTimeAmount: true, termMonths: true, probability: true, wonAt: true, lostAt: true, createdAt: true, lastActivityAt: true, stage: { select: { probability: true, slaDays: true } }, owner: { select: { name: true } } } }),
    listGoals(today),
    prisma.tender.findMany({ where: { deletedAt: null, ...inScope }, select: { status: true, estimatedValue: true, ourProposalValue: true, resultAt: true, homologatedAt: true, createdAt: true, updatedAt: true, deadlines: { where: { done: false, dueAt: { gte: new Date(), lte: d90 } }, select: { id: true } }, checklist: { where: { required: true, done: false, certificateId: { not: null } }, select: { certificateId: true } } } }),
    prisma.ticket.findMany({ where: { deletedAt: null, OR: [{ entityId: null }, inScope], AND: [{ OR: [{ status: { in: TICKET_OPEN_STATUSES } }, { resolvedAt: { gte: fromD, lte: toD } }] }] }, select: { status: true, openedAt: true, firstResponseAt: true, firstResponseDueAt: true, resolvedAt: true, resolutionDueAt: true, satisfactionScore: true } }),
    prisma.commission.findMany({ where: { partnerId: f.partnerId, invoice: inScope }, select: { status: true, amount: true, partnerId: true, invoice: { select: { paidAmount: true, amount: true, status: true, entityId: true } } } }),
    prisma.partner.findMany({ where: { deletedAt: null, isActive: true, id: f.partnerId }, select: { id: true, name: true, _count: { select: { entities: true } } } }),
    prisma.contractRenewal.findMany({ where: { contract: inScope, OR: [{ status: 'OPEN' }, { decidedAt: { gte: fromD, lte: toD } }] }, select: { status: true } }),
    prisma.contract.count({ where: { status: 'DRAFT', deletedAt: null, ...inScope } }),
  ]);

  // ---- carteira (ciclo de vida derivado, mesma regra da lista de entidades)
  const lifecycle = (e: (typeof entities)[number]): 'CLIENTE' | 'EX_CLIENTE' | 'LEAD' => (e.contracts.some((c) => c.status === 'ACTIVE') ? 'CLIENTE' : e.contracts.length || e._count.invoices ? 'EX_CLIENTE' : 'LEAD');
  const byUf = new Map<string, { uf: string; clients: number; leads: number; exClients: number }>();
  const byType = new Map<string, { type: string; clients: number; total: number }>();
  let clients = 0, exClients = 0, leads = 0, newClients = 0, lostClients = 0;
  for (const e of entities) {
    const lc = lifecycle(e);
    if (lc === 'CLIENTE') clients += 1; else if (lc === 'EX_CLIENTE') exClients += 1; else leads += 1;
    const u = byUf.get(e.uf) ?? { uf: e.uf, clients: 0, leads: 0, exClients: 0 }; if (lc === 'CLIENTE') u.clients += 1; else if (lc === 'LEAD') u.leads += 1; else u.exClients += 1; byUf.set(e.uf, u);
    const t = byType.get(e.type) ?? { type: e.type, clients: 0, total: 0 }; t.total += 1; if (lc === 'CLIENTE') t.clients += 1; byType.set(e.type, t);
    const firstStart = e.contracts.map((c) => c.activatedAt ?? c.startDate ?? c.createdAt).filter(Boolean).sort((a, b) => a!.getTime() - b!.getTime())[0];
    if (firstStart && firstStart >= fromD && firstStart <= toD) newClients += 1;
    if (lc === 'EX_CLIENTE') { const lastEnd = e.contracts.map((c) => c.terminatedAt ?? c.endDate).filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0]; if (lastEnd && lastEnd >= fromD && lastEnd <= toD) lostClients += 1; }
  }

  // ---- receita: prevista (projeção) × faturada × recebida (confirmado) por competência
  const months: string[] = []; { let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7)); for (let i = 0; i < periodMonths && i < 36; i += 1) { months.push(`${y}-${String(m).padStart(2, '0')}`); m += 1; if (m > 12) { m = 1; y += 1; } } }
  const series = new Map(months.map((c) => [c, { competence: c, forecast: Number(fc.forecastMonthly), invoiced: 0, received: 0, pending: 0 }]));
  let invoiced = 0, received = 0, pending = 0, overdue = 0; const defaulters = new Set<string>();
  const regionInv = new Map<string, { invoiced: number; received: number; pending: number }>();
  for (const i of invoices) {
    const comp = `${i.competenceYear}-${String(i.competenceMonth).padStart(2, '0')}`;
    const inPeriod = i.issueDate ? i.issueDate >= fromD && i.issueDate <= toD : comp >= from.slice(0, 7) && comp <= to.slice(0, 7);
    const rk = `${i.entity.uf}|${i.entity.municipality}`; const r = regionInv.get(rk) ?? { invoiced: 0, received: 0, pending: 0 };
    if (inPeriod) { invoiced += D(i.amount); r.invoiced += D(i.amount); const s = series.get(comp); if (s) s.invoiced += D(i.amount); }
    if (i.status === 'PAID' && i.paidAt && i.paidAt >= fromD && i.paidAt <= toD) { received += D(i.paidAmount ?? i.amount); r.received += D(i.paidAmount ?? i.amount); const s = series.get(comp); if (s) s.received += D(i.paidAmount ?? i.amount); }
    if (i.status === 'PENDING') { pending += D(i.amount); r.pending += D(i.amount); defaulters.add(i.entityId); const s = series.get(comp); if (s) s.pending += D(i.amount); if (i.issueDate && daysBetween(dateToIso(i.issueDate)!, today) > 30) overdue += D(i.amount); }
    regionInv.set(rk, r);
  }

  // ---- contratos
  const expiring = contracts.filter((c) => c.endDate && c.endDate >= isoToDate(today) && c.endDate <= d90);
  const region = new Map<string, ExecutiveDashboard['byRegion'][number]>();
  for (const e of entities) { const k = `${e.uf}|${e.municipality}`; const r = region.get(k) ?? { uf: e.uf, municipality: e.municipality, clients: 0, activeContracts: 0, monthly: '0.00', invoiced: '0.00', received: '0.00', pending: '0.00' }; if (lifecycle(e) === 'CLIENTE') r.clients += 1; region.set(k, r); }
  const regionMonthly = new Map<string, number>();
  for (const row of fc.forecastRows) { const c = contracts.find((x) => x.id === row.contractId); if (!c) continue; const k = `${c.entity.uf}|${c.entity.municipality}`; regionMonthly.set(k, (regionMonthly.get(k) ?? 0) + Number(row.monthly)); const r = region.get(k); if (r) r.activeContracts += 1; }
  for (const [k, r] of region) { const inv = regionInv.get(k); r.monthly = money(regionMonthly.get(k) ?? 0); r.invoiced = money(inv?.invoiced ?? 0); r.received = money(inv?.received ?? 0); r.pending = money(inv?.pending ?? 0); }

  // ---- vendas
  const open = opps.filter((o) => o.status === 'OPEN'); const won = opps.filter((o) => o.status === 'WON'); const lost = opps.filter((o) => o.status === 'LOST');
  const ownerMap = new Map<string, { name: string; open: number; won: number; wonAmount: number; lost: number }>();
  for (const o of opps) { const k = o.owner?.name ?? 'Sem responsável'; const e = ownerMap.get(k) ?? { name: k, open: 0, won: 0, wonAmount: 0, lost: 0 }; if (o.status === 'OPEN') e.open += 1; else if (o.status === 'WON') { e.won += 1; e.wonAmount += oppTotal(o); } else e.lost += 1; ownerMap.set(k, e); }
  const stalled = open.filter((o) => { const days = o.stage.slaDays ?? 15; return daysBetween((o.lastActivityAt ?? o.createdAt).toISOString().slice(0, 10), today) > days; }).length;

  // ---- licitações
  const inProgress = tenders.filter((t) => ['IDENTIFIED', 'ANALYZING', 'PREPARING', 'SUBMITTED', 'IN_SESSION'].includes(t.status));
  const decided = tenders.filter((t) => ['WON', 'HOMOLOGATED', 'LOST'].includes(t.status) && (t.resultAt ?? t.homologatedAt ?? t.updatedAt) >= fromD && (t.resultAt ?? t.homologatedAt ?? t.updatedAt) <= toD);
  const tWon = decided.filter((t) => t.status !== 'LOST');
  // certidões vencidas bloqueando checklist (sem repetir a consulta de validade: usa a nota de saúde/licitação já calculada em `tenders.get`; aqui só conta itens obrigatórios com certidão pendentes)
  const blockedChecklists = inProgress.filter((t) => t.checklist.length > 0).length;

  // ---- atendimento
  const now = new Date();
  const tOpen = tickets.filter((t) => TICKET_OPEN_STATUSES.includes(t.status as never));
  const breached = tOpen.filter((t) => (t.resolutionDueAt && t.resolutionDueAt < now) || (!t.firstResponseAt && t.firstResponseDueAt && t.firstResponseDueAt < now)).length;
  const atRisk = tOpen.filter((t) => !((t.resolutionDueAt && t.resolutionDueAt < now) || (!t.firstResponseAt && t.firstResponseDueAt && t.firstResponseDueAt < now)) && ((t.resolutionDueAt && t.resolutionDueAt.getTime() - now.getTime() <= 2 * 3_600_000) || (!t.firstResponseAt && t.firstResponseDueAt && t.firstResponseDueAt.getTime() - now.getTime() <= 2 * 3_600_000))).length;
  const resolved = tickets.filter((t) => t.resolvedAt && t.resolvedAt >= fromD && t.resolvedAt <= toD);
  const rated = resolved.filter((t) => t.satisfactionScore != null);

  // ---- parceiros e comissões
  const cSum = (s: string) => commissions.filter((c) => c.status === s).reduce((a, c) => a + D(c.amount), 0);
  const partnerAgg = new Map<string, { name: string; entities: number; received: number; commissions: number }>();
  for (const p of partners) partnerAgg.set(p.id, { name: p.name, entities: p._count.entities, received: 0, commissions: 0 });
  for (const c of commissions) { const p = partnerAgg.get(c.partnerId); if (!p) continue; if (c.status === 'DUE' || c.status === 'PAID') { p.commissions += D(c.amount); if (c.invoice.status === 'PAID') p.received += D(c.invoice.paidAmount ?? c.invoice.amount); } }

  // ---- saúde da carteira (nota já calculada pelo Financeiro)
  const scored = entities.filter((e) => lifecycle(e) !== 'LEAD');
  const bands = { healthy: 0, attention: 0, risk: 0, noData: 0 };
  for (const e of scored) { const b = band(e.healthScore ?? null); if (b === 'SAUDAVEL') bands.healthy += 1; else if (b === 'ATENCAO') bands.attention += 1; else if (b === 'RISCO') bands.risk += 1; else bands.noData += 1; }

  return {
    generatedAt: new Date().toISOString(), period: { from, to }, scope: describeScope(f),
    portfolio: { total: entities.length, clients, exClients, leads, newClientsInPeriod: newClients, lostClientsInPeriod: lostClients, byUf: [...byUf.values()].sort((a, b) => b.clients - a.clients), byType: [...byType.values()].sort((a, b) => b.total - a.total) },
    revenue: { forecastMonthly: fc.forecastMonthly, forecastPeriod: money(Number(fc.forecastMonthly) * periodMonths), invoiced: money(invoiced), received: money(received), pending: money(pending), overdue: money(overdue), defaultersCount: defaulters.size, defaultRate: pct(pending, invoiced + pending), series: [...series.values()].map((s) => ({ competence: s.competence, forecast: money(s.forecast), invoiced: money(s.invoiced), received: money(s.received), pending: money(s.pending) })) },
    contracts: { active: contracts.length, activeMonthly: fc.forecastMonthly, expiring90: expiring.length, expiring90Monthly: money(expiring.reduce((a, c) => a + Number(fc.forecastRows.find((r) => r.contractId === c.id)?.monthly ?? 0), 0)), renewalsOpen: renewals.filter((r) => r.status === 'OPEN').length, renewedInPeriod: renewals.filter((r) => r.status === 'RENEWED').length, notRenewedInPeriod: renewals.filter((r) => r.status === 'NOT_RENEWED').length, draft: draftContracts },
    sales: { open: open.length, openAmount: money(open.reduce((a, o) => a + oppTotal(o), 0)), weightedAmount: money(open.reduce((a, o) => a + (oppTotal(o) * (o.probability ?? o.stage.probability)) / 100, 0)), won: won.length, wonAmount: money(won.reduce((a, o) => a + oppTotal(o), 0)), lost: lost.length, conversionRate: pct(won.length, won.length + lost.length), avgCycleDays: avg(won.filter((o) => o.wonAt).map((o) => daysBetween(o.createdAt.toISOString().slice(0, 10), o.wonAt!.toISOString().slice(0, 10)))), stalled, byOwner: [...ownerMap.values()].map((e) => ({ ...e, wonAmount: money(e.wonAmount) })).sort((a, b) => Number(b.wonAmount) - Number(a.wonAmount) || b.open - a.open), goals: goals.map((g) => ({ label: g.label ?? g.metric, userName: g.userName, target: g.target, achieved: g.achieved, percent: g.percent })) },
    tenders: { inProgress: inProgress.length, inProgressValue: money(inProgress.reduce((a, t) => a + D(t.estimatedValue), 0)), submittedInPeriod: tenders.filter((t) => ['SUBMITTED', 'IN_SESSION'].includes(t.status) || decided.includes(t)).length, wonInPeriod: tWon.length, lostInPeriod: decided.length - tWon.length, winRate: pct(tWon.length, decided.length), wonValue: money(tWon.reduce((a, t) => a + D(t.ourProposalValue ?? t.estimatedValue), 0)), nextDeadlines: inProgress.reduce((a, t) => a + t.deadlines.length, 0), blockedChecklists },
    support: { open: tOpen.length, breached, atRisk, resolvedInPeriod: resolved.length, avgFirstResponseHours: avg(resolved.filter((t) => t.firstResponseAt).map((t) => (t.firstResponseAt!.getTime() - t.openedAt.getTime()) / 3_600_000)), avgResolutionHours: avg(resolved.map((t) => (t.resolvedAt!.getTime() - t.openedAt.getTime()) / 3_600_000)), satisfactionAvg: avg(rated.map((t) => t.satisfactionScore!)), satisfactionCount: rated.length },
    partners: { active: partners.length, forecast: money(cSum('FORECAST')), due: money(cSum('DUE')), paid: money(cSum('PAID')), top: [...partnerAgg.values()].sort((a, b) => b.commissions - a.commissions).slice(0, 8).map((p) => ({ name: p.name, entities: p.entities, received: money(p.received), commissions: money(p.commissions) })) },
    health: { ...bands, avgScore: avg(scored.map((e) => e.healthScore).filter((s): s is number => s != null)), worst: scored.filter((e) => e.healthScore != null).sort((a, b) => a.healthScore! - b.healthScore!).slice(0, 8).map((e) => ({ entityId: e.id, name: e.shortName ?? e.name, score: e.healthScore!, municipality: e.municipality, uf: e.uf })) },
    byRegion: [...region.values()].sort((a, b) => Number(b.received) - Number(a.received) || b.clients - a.clients),
  };
}
