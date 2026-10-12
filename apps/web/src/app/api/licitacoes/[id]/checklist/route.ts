import { tenderChecklistItemSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { addChecklistItem } from '@/server/services/tenders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(['tenders.write'], async (ctx) => addChecklistItem(ctx.params['id']!, await json(ctx.req, tenderChecklistItemSchema)));
