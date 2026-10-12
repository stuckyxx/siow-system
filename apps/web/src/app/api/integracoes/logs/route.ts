import { z } from 'zod';
import { parseQuery, route } from '@/server/http';
import { logs } from '@/server/services/integrations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ key: z.string().max(30).optional(), status: z.string().max(20).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(30) });
export const GET = route(['integrations.manage'], async (ctx) => logs(parseQuery(ctx.query, schema)));
