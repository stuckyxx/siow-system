import { terminateContractSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { terminate } from '@/server/services/contracts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/financeiro/contracts/:id/terminate */
export const POST = route(['contracts.write'], async (ctx) => terminate(ctx, ctx.params['id']!, await json(ctx.req, terminateContractSchema)));
