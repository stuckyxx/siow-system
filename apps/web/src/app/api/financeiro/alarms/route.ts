import { createIssuanceAlarmSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { create, list } from '@/server/services/alarms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/financeiro/alarms?entityId= — alarmes de emissão. */
export const GET = route(['entities.read'], async (ctx) => list(ctx.query['entityId'] || undefined));
/** POST /api/financeiro/alarms — cria alarme (dia do mês + antecedência). */
export const POST = route(['entities.write'], async (ctx) => create(ctx, await json(ctx.req, createIssuanceAlarmSchema)));
