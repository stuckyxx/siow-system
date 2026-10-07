import { dashboardFilterSchema } from '@siow/shared';
import { parseQuery, route } from '@/server/http';
import { build } from '@/server/services/dashboard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/financeiro/dashboard — cards, séries, atenção e previsão (forecastMonthly/forecastAnnual/forecastRows). */
export const GET = route(['dashboard.read'], async (ctx) => build(parseQuery(ctx.query, dashboardFilterSchema)));
