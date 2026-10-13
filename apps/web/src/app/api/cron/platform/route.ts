import { cronRoute } from '@/server/cron';
import { runBilling } from '@/server/services/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** GET /api/cron/platform — faturas de assinatura do mês, vencidas, bloqueio suave após carência e fim de testes. */
export const GET = cronRoute(async () => runBilling());
