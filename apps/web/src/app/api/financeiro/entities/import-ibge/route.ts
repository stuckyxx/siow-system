import { importIbgeSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { importIbge } from '@/server/services/entities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** POST /api/financeiro/entities/import-ibge — prévia (dryRun) ou cadastro dos municípios de uma UF como leads. */
export const POST = route(['entities.write'], async (ctx) => importIbge(ctx, await json(ctx.req, importIbgeSchema)));
