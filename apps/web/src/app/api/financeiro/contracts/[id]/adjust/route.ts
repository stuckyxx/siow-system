import { adjustContractSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { adjust } from '@/server/services/contracts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/financeiro/contracts/:id/adjust */
export const POST = route(['contracts.write'], async (ctx) => adjust(ctx, ctx.params['id']!, await json(ctx.req, adjustContractSchema)));
