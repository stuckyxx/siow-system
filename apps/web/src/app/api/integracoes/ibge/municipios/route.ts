import { z } from 'zod';
import { parseQuery, route } from '@/server/http';
import { municipalities } from '@/server/services/lookups';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(['entities.read'], async (ctx) => municipalities(parseQuery(ctx.query, z.object({ uf: z.string().length(2) })).uf));
