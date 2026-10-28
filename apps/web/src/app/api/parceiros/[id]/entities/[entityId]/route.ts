import { partnerEntityValueSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { setEntityValue } from '@/server/services/partners';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** PATCH /api/parceiros/:id/entities/:entityId { monthlyValue, notes } — valor mensal do vínculo. */
export const PATCH = route(['partners.manage'], async (ctx) => setEntityValue(ctx, ctx.params['id']!, ctx.params['entityId']!, await json(ctx.req, partnerEntityValueSchema)));
