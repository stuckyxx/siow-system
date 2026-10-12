import { commissionListFilterSchema } from '@siow/shared';
import { parseQuery, route } from '@/server/http';
import { list } from '@/server/services/commissions';
import { mine, statement } from '@/server/services/partners';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/parceiros/me — portal do parceiro: extrato e comissões SOMENTE do parceiro ligado ao usuário. */
export const GET = route(['partners.portal'], async (ctx) => {
  const p = await mine(ctx);
  const f = parseQuery({ ...ctx.query, partnerId: p.id }, commissionListFilterSchema);
  const [st, commissions] = await Promise.all([statement(p.id), list({ ...f, partnerId: p.id })]);
  return { ...st, commissions };
});
