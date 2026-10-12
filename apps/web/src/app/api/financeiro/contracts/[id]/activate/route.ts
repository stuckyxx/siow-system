import { activateContractSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { activate } from '@/server/services/contracts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/financeiro/contracts/:id/activate */
export const POST = route(['contracts.write'], async (ctx) => activate(ctx, ctx.params['id']!, await json(ctx.req, activateContractSchema)));
