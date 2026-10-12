import { cronRoute, forEachOrganization } from '@/server/cron';
import { pollSignatures } from '@/server/services/service-orders';
import { dispatchPending } from '@/server/services/webhooks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** GET /api/cron/integracoes — reentrega webhooks pendentes e consulta assinaturas em aberto (por organização). */
export const GET = cronRoute(async () => {
  const results = await forEachOrganization(async () => ({ webhooks: await dispatchPending({ budgetMs: 20_000 }), signatures: await pollSignatures() }));
  const slugs = Object.keys(results);
  return slugs.length === 1 ? results[slugs[0]!] : { organizations: results };
});
