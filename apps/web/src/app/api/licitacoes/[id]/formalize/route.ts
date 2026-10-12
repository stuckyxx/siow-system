import { formalizeTenderSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { formalize } from '@/server/services/tenders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST — homologação → contrato (rascunho por padrão; ativo só com confirmação). */
export const POST = route(['tenders.write', 'contracts.write'], async (ctx) => formalize(ctx, ctx.params['id']!, await json(ctx.req, formalizeTenderSchema)));
