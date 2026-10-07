import type { Config } from '@netlify/functions';
/** Chama a rota de sincronização do próprio app com o segredo do cron (Netlify Scheduled Function). */
export default async () => {
  const base = process.env.APP_URL ?? process.env.URL ?? '';
  const res = await fetch(`${base}/api/cron/sync`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` } });
  console.log('scheduled-sync', res.status, await res.text().catch(() => ''));
  return new Response(null, { status: 200 });
};
export const config: Config = { schedule: '*/20 * * * *' };
