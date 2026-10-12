import { z } from 'zod';
import { json, route } from '@/server/http';
import { upsert, type IntegrationKey } from '@/server/services/integrations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ provider: z.string().max(40).optional(), isEnabled: z.boolean().optional(), config: z.record(z.string().max(500)).optional(), secrets: z.record(z.string().max(2000)).optional() });
/** PUT /api/integracoes/[key] — salva provedor, campos e segredos (vazio apaga; ausente mantém). */
export const PUT = route(['integrations.manage'], async (ctx) => upsert(ctx, ctx.params['key']!.toUpperCase() as IntegrationKey, await json(ctx.req, schema)));
