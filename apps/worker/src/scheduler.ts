import { JOB_NAMES } from '@siow/queue';
import type { WorkerContext } from './context.js';

/**
 * Agendamentos (repeatable jobs do BullMQ):
 *  - sync-all: cron configurável (Setting sync.cron > env SYNC_CRON > 6/6h)
 *  - daily-checks: todo dia às 07:00 (America/Sao_Paulo)
 * Alterar o cron nas configurações e reiniciar o worker (ou chamar
 * installSchedules) substitui o agendamento anterior.
 */
export async function installSchedules(ctx: WorkerContext): Promise<void> {
  const setting = await ctx.prisma.setting.findUnique({ where: { key: 'sync.cron' } });
  const cron = (typeof setting?.value === 'string' ? setting.value : null) ?? process.env['SYNC_CRON'] ?? '0 */6 * * *';
  const tz = process.env['TZ'] ?? 'America/Sao_Paulo';

  await ctx.queues.sync.upsertJobScheduler(
    'sync-all-scheduled',
    { pattern: cron, tz },
    { name: JOB_NAMES.syncAll, data: { trigger: 'SCHEDULED' }, opts: { attempts: 1 } },
  );
  await ctx.queues.alerts.upsertJobScheduler(
    'daily-checks',
    { pattern: '0 7 * * *', tz },
    { name: JOB_NAMES.dailyChecks, data: { kind: 'DAILY_CHECKS' } },
  );
  ctx.logger.info({ cron, tz }, 'agendamentos instalados');
}
