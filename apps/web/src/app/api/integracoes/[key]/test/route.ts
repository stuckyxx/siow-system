import { route } from '@/server/http';
import { test, type IntegrationKey } from '@/server/services/integrations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** POST /api/integracoes/[key]/test — testa a conexão com o provedor (sem efeitos colaterais). */
export const POST = route(['integrations.manage'], async (ctx) => test(ctx, ctx.params['key']!.toUpperCase() as IntegrationKey));
