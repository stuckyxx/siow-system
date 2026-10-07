import type { Config } from '@netlify/functions';
/** Verificações diárias (certidões, contratos vencendo, tarefas) — Netlify Scheduled Function. */
export default async () => {
  const base = process.env.APP_URL ?? process.env.URL ?? '';
  const res = await fetch(`${base}/api/cron/daily`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` } });
  console.log('scheduled-daily', res.status, await res.text().catch(() => ''));
  return new Response(null, { status: 200 });
};
export const config: Config = { schedule: '0 9 * * *' };
