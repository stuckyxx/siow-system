import { route } from '@/server/http';
import { prisma } from '@/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/comercial/meta — parâmetros do CRM legíveis por quem tem crm.read (motivos de perda, dias para "parada"). */
export const GET = route(['crm.read'], async () => {
  const rows = await prisma.setting.findMany({ where: { key: { in: ['crm.lossReasons', 'crm.stalledDays'] } } });
  const get = (k: string): unknown => rows.find((r) => r.key === k)?.value;
  const reasons = get('crm.lossReasons');
  return { lossReasons: Array.isArray(reasons) ? (reasons as string[]) : ['Preço', 'Concorrente', 'Sem orçamento', 'Sem interesse', 'Troca de gestão', 'Licitação perdida', 'Outro'], stalledDays: typeof get('crm.stalledDays') === 'number' ? (get('crm.stalledDays') as number) : 15 };
});
