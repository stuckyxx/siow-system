import { updateTenderChecklistItemSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { removeChecklistItem, updateChecklistItem } from '@/server/services/tenders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PATCH = route(['tenders.write'], async (ctx) => updateChecklistItem(ctx, ctx.params['id']!, ctx.params['iid']!, await json(ctx.req, updateTenderChecklistItemSchema)));
export const DELETE = route(['tenders.write'], async (ctx) => { await removeChecklistItem(ctx.params['id']!, ctx.params['iid']!); return { ok: true }; });
