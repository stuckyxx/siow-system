import { sendMessageSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { send } from '@/server/services/messaging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/financeiro/messages/send — envia pelo provedor ou registra para envio manual: { message, manualLink, sent }. */
export const POST = route(['collections.manage'], async (ctx) => send(ctx, await json(ctx.req, sendMessageSchema)));
