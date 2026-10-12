/**
 * Verificações diárias (spec §13, §22, §7) — porte de apps/worker/src/jobs/alerts.ts:
 * certidões vencendo/vencidas, contratos próximos do vencimento (e expiração
 * automática) e tarefas do dia. Notificações são deduplicadas por chave para
 * não repetir todo dia. Executado pelo cron GET /api/cron/daily.
 */
import { addDaysIso, isoToDate, todayIso } from '@siow/shared';
import { prisma } from '../db.js';
import { currentOrgId } from '../tenant.js';
import { notifyDue } from './alarms.js';
import { refreshHealthAll } from './health.js';
import { stalled as stalledOpportunities } from './crm/opportunities.js';
import { detectRenewals } from './renewals.js';
import { recompute as recomputeCommissions } from './commissions.js';
import { notifyDeadlines as notifyTenderDeadlines } from './tenders.js';

async function settingNumber(key: string, fallback: number): Promise<number> {
  const s = await prisma.setting.findUnique({ where: { key } });
  const v = s?.value;
  return typeof v === 'number' ? v : Number(v ?? fallback) || fallback;
}

export interface DailyChecksResult {
  date: string;
  certificates: { checked: number; expiring: number; expired: number };
  contracts: { checked: number; expiredNow: number };
  tasks: { due: number; overdue: number };
  issuance: { due: number; late: number };
  health: { computed: number; withoutData: number };
  opportunities: { stalled: number };
  renewals: { checked: number; created: number };
  commissions: { rules: number; created: number; updated: number; reversed: number; removed: number };
  tenders: { due: number; overdue: number };
  durationMs: number;
}

export async function runDailyChecks(): Promise<DailyChecksResult> {
  const startedAt = Date.now();
  const today = todayIso();
  const certDays = await settingNumber('certificates.expiringDays', Number(process.env['CERTIFICATE_EXPIRING_DAYS'] ?? 30));
  const contractDays = await settingNumber('contracts.expiringDays', Number(process.env['CONTRACT_EXPIRING_DAYS'] ?? 60));

  // ---- certidões ----
  const versions = await prisma.certificateVersion.findMany({
    where: { isCurrent: true, validUntil: { not: null, lte: isoToDate(addDaysIso(today, certDays)) }, certificate: { isActive: true, deletedAt: null } },
    include: { certificate: true },
  });
  let expiring = 0;
  let expired = 0;
  for (const v of versions) {
    const validUntil = v.validUntil!.toISOString().slice(0, 10);
    const isExpired = validUntil < today;
    if (isExpired) expired += 1; else expiring += 1;
    const type = isExpired ? 'CERTIFICATE_EXPIRED' : 'CERTIFICATE_EXPIRING';
    await prisma.notification.upsert({
      where: { dedupeKey: `${type}:${v.id}` },
      update: {},
      create: {
        organizationId: currentOrgId(),
        type,
        title: isExpired ? `Certidão vencida: ${v.certificate.name}` : `Certidão vencendo: ${v.certificate.name}`,
        body: `Validade: ${validUntil.split('-').reverse().join('/')}`,
        entityId: v.certificate.entityId,
        referenceType: 'certificateVersion',
        referenceId: v.id,
        dedupeKey: `${type}:${v.id}`,
      },
    });
  }

  // ---- contratos ----
  const contracts = await prisma.contract.findMany({
    where: { status: 'ACTIVE', deletedAt: null, endDate: { not: null, lte: isoToDate(addDaysIso(today, contractDays)) } },
    include: { entity: true },
  });
  let expiredNow = 0;
  for (const c of contracts) {
    const end = c.endDate!.toISOString().slice(0, 10);
    await prisma.notification.upsert({
      where: { dedupeKey: `CONTRACT_EXPIRING:${c.id}:${end}` },
      update: {},
      create: {
        organizationId: currentOrgId(),
        type: 'CONTRACT_EXPIRING',
        title: `Contrato ${c.number} de ${c.entity.shortName ?? c.entity.name} vence em ${end.split('-').reverse().join('/')}`,
        entityId: c.entityId,
        referenceType: 'contract',
        referenceId: c.id,
        dedupeKey: `CONTRACT_EXPIRING:${c.id}:${end}`,
      },
    });
    if (end < today) {
      await prisma.contract.update({ where: { id: c.id }, data: { status: 'EXPIRED' } });
      expiredNow += 1;
    }
  }

  // ---- tarefas do dia / atrasadas ----
  const tasks = await prisma.financialTask.findMany({
    where: { status: { in: ['PENDING', 'IN_PROGRESS'] }, deletedAt: null, dueDate: { lte: isoToDate(today) }, assigneeUserId: { not: null } },
  });
  let overdue = 0;
  for (const t of tasks) {
    const isOverdue = t.dueDate.toISOString().slice(0, 10) < today;
    if (isOverdue) overdue += 1;
    await prisma.notification.upsert({
      where: { dedupeKey: `TASK_DUE:${t.id}:${today}` },
      update: {},
      create: {
        organizationId: currentOrgId(),
        type: 'TASK_DUE',
        userId: t.assigneeUserId,
        title: isOverdue ? `Tarefa atrasada: ${t.title}` : `Tarefa para hoje: ${t.title}`,
        entityId: t.entityId,
        referenceType: 'task',
        referenceId: t.id,
        dedupeKey: `TASK_DUE:${t.id}:${today}`,
      },
    });
  }

  // ---- alarmes de emissão de nota ----
  const issuance = await notifyDue(today);
  // ---- saúde do cliente ----
  const health = await refreshHealthAll(today);
  // ---- renovações de contrato (Fase 3): abre oportunidade + tarefa na janela de renovação ----
  const renewals = await detectRenewals(today);
  // ---- comissões (Fase 4): recálculo idempotente de segurança ----
  const commissions = await recomputeCommissions();
  // ---- prazos de licitações (Fase 5) ----
  const tenders = await notifyTenderDeadlines(today);
  // ---- oportunidades paradas (CRM): uma notificação por oportunidade e por semana, para o responsável ----
  const stalledOpps = await stalledOpportunities();
  const week = `${today.slice(0, 4)}-W${String(Math.ceil((new Date(today).getUTCDate() + new Date(`${today.slice(0, 7)}-01`).getUTCDay()) / 7)).padStart(2, '0')}-${today.slice(5, 7)}`;
  for (const o of stalledOpps) {
    await prisma.notification.upsert({
      where: { dedupeKey: `OPPORTUNITY_STALLED:${o.id}:${week}` },
      update: {},
      create: {
        organizationId: currentOrgId(), type: 'OPPORTUNITY_STALLED', userId: o.ownerUserId,
        title: `Oportunidade parada há ${o.daysInStage} dias: ${o.title} (${o.entity.shortName ?? o.entity.name}, etapa ${o.stage.name})`,
        entityId: o.entityId, referenceType: 'opportunity', referenceId: o.id, dedupeKey: `OPPORTUNITY_STALLED:${o.id}:${week}`,
      },
    });
  }

  const result: DailyChecksResult = {
    date: today,
    certificates: { checked: versions.length, expiring, expired },
    contracts: { checked: contracts.length, expiredNow },
    tasks: { due: tasks.length - overdue, overdue },
    issuance,
    health,
    opportunities: { stalled: stalledOpps.length },
    renewals,
    commissions,
    tenders,
    durationMs: Date.now() - startedAt,
  };
  console.info('[cron] verificações diárias concluídas', result);
  return result;
}
