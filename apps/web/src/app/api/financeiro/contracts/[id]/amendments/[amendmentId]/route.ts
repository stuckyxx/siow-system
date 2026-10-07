import { route } from '@/server/http';
import { removeAmendment } from '@/server/services/contracts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** DELETE /api/financeiro/contracts/[id]/amendments/[amendmentId] — remove e recompõe vigência/valor do contrato. */
export const DELETE = route(['contracts.write'], async (ctx) => {
  await removeAmendment(ctx, ctx.params['id']!, ctx.params['amendmentId']!);
  return { ok: true };
});
