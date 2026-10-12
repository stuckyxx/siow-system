import { tenderDeadlineSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { removeDeadline, updateDeadline } from '@/server/services/tenders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PATCH = route(['tenders.write'], async (ctx) => updateDeadline(ctx, ctx.params['id']!, ctx.params['did']!, await json(ctx.req, tenderDeadlineSchema.partial())));
export const DELETE = route(['tenders.write'], async (ctx) => { await removeDeadline(ctx.params['id']!, ctx.params['did']!); return { ok: true }; });
