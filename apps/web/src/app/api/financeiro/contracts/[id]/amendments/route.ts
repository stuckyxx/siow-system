import { createAmendmentSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { addAmendment } from '@/server/services/contracts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/financeiro/contracts/[id]/amendments — cria aditivo e aplica seus efeitos ao contrato. */
export const POST = route(['contracts.write'], async (ctx) => addAmendment(ctx, ctx.params['id']!, await json(ctx.req, createAmendmentSchema)));
