import { dashboardFilterSchema } from '@siow/shared';
import { parseQuery, route } from '@/server/http';
import { forecast } from '@/server/services/dashboard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/financeiro/dashboard/forecast — previsão de faturamento dos contratos ativos (mensal/anual + linhas). */
export const GET = route(['dashboard.read'], async (ctx) => forecast(parseQuery(ctx.query, dashboardFilterSchema)));
