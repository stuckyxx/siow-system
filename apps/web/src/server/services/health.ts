/**
 * Saúde do cliente (0–100), calculada no cron diário por entidade. Regras verificáveis com pesos
 * configuráveis em Setting `health.weights`. Entidade sem notas e sem contratos = SEM DADOS (null),
 * distinto de situação negativa. Fatores gravados em entity_health_snapshots para explicar a nota.
 */
import { daysBetween, todayIso, type EntityHealth, type HealthFactor } from '@siow/shared';
import { prisma } from '../db.js';
import { currentOrgId } from '../tenant.js';

export interface HealthWeights { overdueInvoice: number; overdueOver60: number; collectionNoReply: number; contractEndingUnrenewed: number; syncFailed: number; recentPayment: number }
export const DEFAULT_WEIGHTS: HealthWeights = { overdueInvoice: 10, overdueOver60: 20, collectionNoReply: 10, contractEndingUnrenewed: 15, syncFailed: 5, recentPayment: 5 };

export async function weights(): Promise<HealthWeights> {
  const s = await prisma.setting.findUnique({ where: { key: 'health.weights' } });
  const v = (s?.value ?? {}) as Partial<HealthWeights>;
  return { ...DEFAULT_WEIGHTS, ...Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'number')) } as HealthWeights;
}

export function band(score: number | null): EntityHealth['band'] { return score === null ? 'SEM_DADOS' : score >= 75 ? 'SAUDAVEL' : score >= 50 ? 'ATENCAO' : 'RISCO'; }

/** Calcula a saúde de uma entidade a partir do que existe hoje (não grava). */
export async function computeHealth(entityId: string, today = todayIso(), w?: HealthWeights): Promise<{ score: number | null; factors: HealthFactor[] }> {
  const W = w ?? (await weights());
  const [invoices, contracts, cases, failedRuns] = await Promise.all([
    prisma.invoice.findMany({ where: { entityId, deletedAt: null, status: { in: ['PENDING', 'PAID'] } }, select: { status: true, issueDate: true, paidAt: true } }),
    prisma.contract.findMany({ where: { entityId, deletedAt: null }, select: { status: true, endDate: true } }),
    prisma.collectionCase.findMany({ where: { entityId, status: { in: ['SENT', 'AWAITING_PAYMENT'] } }, select: { id: true, updatedAt: true } }),
    prisma.dataSource.count({ where: { entityId, deletedAt: null, lastSyncStatus: 'FAILED' } }),
  ]);
  if (invoices.length === 0 && contracts.length === 0) return { score: null, factors: [{ key: 'no_data', label: 'Sem dados', impact: 0, detail: 'Entidade sem notas e sem contratos: saúde não calculada' }] };
  const factors: HealthFactor[] = [];
  let score = 100;
  const overdueDays = invoices.filter((i) => i.status === 'PENDING' && i.issueDate).map((i) => daysBetween(i.issueDate!.toISOString().slice(0, 10), today) - 30).filter((d) => d > 0);
  if (overdueDays.length) { const impact = -Math.min(5, overdueDays.length) * W.overdueInvoice; score += impact; factors.push({ key: 'overdue', label: 'Notas em atraso', impact, detail: `${overdueDays.length} nota(s) com mais de 30 dias` }); }
  if (overdueDays.some((d) => d > 60)) { score -= W.overdueOver60; factors.push({ key: 'overdue60', label: 'Atraso superior a 60 dias', impact: -W.overdueOver60, detail: `maior atraso: ${Math.max(...overdueDays) + 30} dias` }); }
  const stale = cases.filter((c) => daysBetween(c.updatedAt.toISOString().slice(0, 10), today) > 15).length;
  if (stale) { const impact = -Math.min(3, stale) * W.collectionNoReply; score += impact; factors.push({ key: 'collection', label: 'Cobranças sem resposta', impact, detail: `${stale} cobrança(s) sem retorno há mais de 15 dias` }); }
  const active = contracts.filter((c) => c.status === 'ACTIVE');
  const ending = active.filter((c) => c.endDate && daysBetween(today, c.endDate.toISOString().slice(0, 10)) <= 90 && daysBetween(today, c.endDate.toISOString().slice(0, 10)) >= 0);
  if (ending.length && ending.length === active.length) { score -= W.contractEndingUnrenewed; factors.push({ key: 'contract_ending', label: 'Contrato a vencer sem renovação', impact: -W.contractEndingUnrenewed, detail: `${ending.length} contrato(s) terminam em até 90 dias` }); }
  if (active.length === 0 && contracts.length > 0) { score -= 30; factors.push({ key: 'no_active_contract', label: 'Sem contrato ativo', impact: -30, detail: 'Todos os contratos estão encerrados/expirados' }); }
  if (failedRuns) { score -= W.syncFailed; factors.push({ key: 'sync_failed', label: 'Sincronização com falha', impact: -W.syncFailed, detail: `${failedRuns} fonte(s) com a última sincronização falha` }); }
  const lastPaid = invoices.filter((i) => i.status === 'PAID' && i.paidAt).map((i) => i.paidAt!.toISOString().slice(0, 10)).sort().at(-1);
  if (lastPaid && daysBetween(lastPaid, today) <= 45) { score = Math.min(100, score + W.recentPayment); factors.push({ key: 'recent_payment', label: 'Pagamento recente', impact: +W.recentPayment, detail: `último pagamento em ${lastPaid.split('-').reverse().join('/')}` }); }
  return { score: Math.max(0, Math.min(100, Math.round(score))), factors };
}

/** Cron diário: grava healthScore na entidade e o snapshot do dia. */
export async function refreshHealthAll(today = todayIso()): Promise<{ computed: number; withoutData: number }> {
  const W = await weights();
  const entities = await prisma.entity.findMany({ where: { deletedAt: null }, select: { id: true } });
  let computed = 0; let withoutData = 0;
  for (const e of entities) {
    const h = await computeHealth(e.id, today, W);
    if (h.score === null) withoutData += 1; else computed += 1;
    await prisma.entity.update({ where: { id: e.id }, data: { healthScore: h.score, healthUpdatedAt: new Date() } });
    await prisma.entityHealthSnapshot.upsert({ where: { entityId_date: { entityId: e.id, date: new Date(`${today}T00:00:00Z`) } }, update: { score: h.score, factors: h.factors as object[] }, create: { organizationId: currentOrgId(), entityId: e.id, date: new Date(`${today}T00:00:00Z`), score: h.score, factors: h.factors as object[] } });
  }
  return { computed, withoutData };
}

export async function getHealth(entityId: string): Promise<EntityHealth> {
  const e = await prisma.entity.findFirst({ where: { id: entityId, deletedAt: null }, select: { healthScore: true, healthUpdatedAt: true } });
  const h = await computeHealth(entityId);
  return { score: h.score, factors: h.factors, updatedAt: e?.healthUpdatedAt?.toISOString() ?? null, band: band(h.score) };
}
