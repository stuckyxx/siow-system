import { createDataSourceSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { addDataSource } from '@/server/services/entities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/financeiro/entities/[id]/data-sources */
export const POST = route(['entities.write'], async (ctx) => addDataSource(ctx, ctx.params['id']!, await json(ctx.req, createDataSourceSchema)));
