import { crmDashboardFilterSchema } from '@siow/shared';
import { parseQuery, route } from '@/server/http';
import { crmDashboard } from '@/server/services/crm/dashboard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/comercial/dashboard?from&to&ownerUserId&pipelineId&uf — indicadores comerciais (calculados). */
export const GET = route(['crm.read'], async (ctx) => crmDashboard(parseQuery(ctx.query, crmDashboardFilterSchema)));
