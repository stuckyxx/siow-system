import { pncpImportSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { importPncp } from '@/server/services/tenders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** POST — importa as publicações selecionadas do PNCP (duplicidade pelo número de controle). */
export const POST = route(['tenders.write'], async (ctx) => importPncp(ctx, await json(ctx.req, pncpImportSchema)));
