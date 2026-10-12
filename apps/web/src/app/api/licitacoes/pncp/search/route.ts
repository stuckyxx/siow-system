import { pncpSearchSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { searchPncp } from '@/server/services/tenders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** POST — consulta pública ao PNCP (somente leitura; nada gravado). */
export const POST = route(['tenders.read'], async (ctx) => searchPncp(await json(ctx.req, pncpSearchSchema)));
