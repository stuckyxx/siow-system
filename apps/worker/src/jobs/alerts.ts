import { addDaysIso, todayIso, isoToDate } from '@siow/shared';
import type { WorkerContext } from '../context.js';

async function settingNumber(ctx: WorkerContext, key: string, fallback: number): Promise<number> {
  const s = await ctx.prisma.setting.findUnique({ where: { key } });
  const v = s?.value;
  return typeof v === 'number' ? v : Number(v ?? fallback) || fallback;
}

/**
 * Verificações diárias (spec §13, §22, §7): certidões vencendo/vencidas,
 * contratos próximos do vencimento e tarefas do dia. Notificações são
 * deduplicadas por chave para não repetir todo dia.
 */
export async function runDailyChecks(ctx: WorkerContext): Promise<void> {
  const today = todayIso();
  const certDays = await settingNumber(ctx, 'certificates.expiringDays', Number(process.env['CERTIFICATE_EXPIRING_DAYS'] ?? 30));
  const contractDays = await settingNumber(ctx, 'contracts.expiringDays', Number(process.env['CONTRACT_EXPIRING_DAYS'] ?? 60));

  // ---- certidões ----
  const versions = await ctx.prisma.certificateVersion.findMany({
    where: { isCurrent: true, validUntil: { not: null, lte: isoToDate(addDaysIso(today, certDays)) }, certificate: { isActive: true, deletedAt: null } },
    include: { certificate: true },
  });
  for (const v of versions) {
    const validUntil = v.validUntil!.toISOString().slice(0, 10);
    const expired = validUntil < today;
    const type = expired ? 'CERTIFICATE_EXPIRED' : 'CERTIFICATE_EXPIRING';
    await ctx.prisma.notification.upsert({
      where: { dedupeKey: `${type}:${v.id}` },
      update: {},
      create: {
        type,
        title: expired ? `Certidão vencida: ${v.certificate.name}` : `Certidão vencendo: ${v.certificate.name}`,
        body: `Validade: ${validUntil.split('-').reverse().join('/')}`,
        entityId: v.certificate.entityId,
        referenceType: 'certificateVersion',
        referenceId: v.id,
        dedupeKey: `${type}:${v.id}`,
      },
    });
  }

  // ---- contratos ----
  const contracts = await ctx.prisma.contract.findMany({
    where: { status: 'ACTIVE', deletedAt: null, endDate: { not: null, lte: isoToDate(addDaysIso(today, contractDays)) } },
    include: { entity: true },
  });
  for (const c of contracts) {
    const end = c.endDate!.toISOString().slice(0, 10);
    await ctx.prisma.notification.upsert({
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
      await ctx.prisma.contract.update({ where: { id: c.id }, data: { status: 'EXPIRED' } });
    }
  }

  // ---- tarefas do dia ----
  const tasks = await ctx.prisma.financialTask.findMany({
    where: { status: { in: ['PENDING', 'IN_PROGRESS'] }, deletedAt: null, dueDate: { lte: isoToDate(today) }, assigneeUserId: { not: null } },
  });
  for (const t of tasks) {
    await ctx.prisma.notification.upsert({
      where: { dedupeKey: `TASK_DUE:${t.id}:${today}` },
      update: {},
      create: {
        type: 'TASK_DUE',
        userId: t.assigneeUserId,
        title: `Tarefa para hoje: ${t.title}`,
        entityId: t.entityId,
        referenceType: 'task',
        referenceId: t.id,
        dedupeKey: `TASK_DUE:${t.id}:${today}`,
      },
    });
  }

  ctx.logger.info({ certificates: versions.length, contracts: contracts.length, tasks: tasks.length }, 'verificações diárias concluídas');
}
