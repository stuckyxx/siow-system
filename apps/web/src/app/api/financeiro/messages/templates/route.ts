import { upsertTemplateSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { listTemplates, upsertTemplate } from '@/server/services/messaging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/financeiro/messages/templates — modelos de mensagem. */
export const GET = route(['collections.read'], async () => listTemplates());

/** PUT /api/financeiro/messages/templates — cria/atualiza modelo pela chave. */
export const PUT = route(['templates.manage'], async (ctx) => upsertTemplate(ctx, await json(ctx.req, upsertTemplateSchema)));
