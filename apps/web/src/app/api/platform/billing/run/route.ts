import { platformRoute } from '@/server/platform-auth';
import { runBilling } from '@/server/services/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** POST — executa a rotina de cobrança agora (mesma do cron). */
export const POST = platformRoute(async () => runBilling());
