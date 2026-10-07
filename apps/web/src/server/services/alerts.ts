/**
 * Verificações diárias (spec §13, §22, §7) — porte de apps/worker/src/jobs/alerts.ts:
 * certidões vencendo/vencidas, contratos próximos do vencimento (e expiração
 * automática) e tarefas do dia. Notificações são deduplicadas por chave para
 * não repetir todo dia. Executado pelo cron GET /api/cron/daily.
 */
import { addDaysIso, isoToDate, todayIso } from '@siow/shared';
import { prisma } from '../db.js';

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

  const result: DailyChecksResult = {
    date: today,
    certificates: { checked: versions.length, expiring, expired },
    contracts: { checked: contracts.length, expiredNow },
    tasks: { due: tasks.length - overdue, overdue },
    durationMs: Date.now() - startedAt,
  };
  console.info('[cron] verificações diárias concluídas', result);
  return result;
}
