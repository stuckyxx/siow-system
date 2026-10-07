import { prepareMessageSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { prepare } from '@/server/services/messaging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/financeiro/messages/prepare — pré-preenche assunto/corpo a partir do modelo e das variáveis. */
export const POST = route(['collections.manage'], async (ctx) => prepare(await json(ctx.req, prepareMessageSchema)));
