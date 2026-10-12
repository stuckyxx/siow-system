import { updatePipelineSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { get, update } from '@/server/services/crm/pipelines';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(['crm.read'], async (ctx) => get(ctx.params['id']!));
/** PATCH — nome e etapas do funil (configuração por organização). */
export const PATCH = route(['crm.manage'], async (ctx) => update(ctx, ctx.params['id']!, await json(ctx.req, updatePipelineSchema)));
