import { resolveConflictSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { resolveConflict } from '@/server/services/invoices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/financeiro/invoices/[id]/conflicts/[conflictId]/resolve */
export const POST = route(['invoices.reconcile'], async (ctx) => resolveConflict(ctx, ctx.params['id']!, ctx.params['conflictId']!, await json(ctx.req, resolveConflictSchema)));
