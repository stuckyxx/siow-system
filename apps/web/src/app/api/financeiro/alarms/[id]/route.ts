import { updateIssuanceAlarmSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { remove, update } from '@/server/services/alarms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** PATCH /api/financeiro/alarms/[id] */
export const PATCH = route(['entities.write'], async (ctx) => update(ctx, ctx.params['id']!, await json(ctx.req, updateIssuanceAlarmSchema)));
/** DELETE /api/financeiro/alarms/[id] — exclusão lógica. */
export const DELETE = route(['entities.write'], async (ctx) => { await remove(ctx, ctx.params['id']!); return { ok: true }; });
