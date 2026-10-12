import { cronRoute, forEachOrganization } from '@/server/cron';
import { runDailyChecks } from '@/server/services/alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/daily — verificações diárias (certidões vencendo/vencidas, contratos vencendo
 * e expiração automática, tarefas do dia/atrasadas → Notifications). Requer bearer CRON_SECRET.
 */
export const GET = cronRoute(async () => {
  const results = await forEachOrganization(() => runDailyChecks());
  const slugs = Object.keys(results);
  return slugs.length === 1 ? results[slugs[0]!] : { organizations: results };
});
