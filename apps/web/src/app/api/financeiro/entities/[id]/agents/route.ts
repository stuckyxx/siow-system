import { createPublicAgentSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { create, list } from '@/server/services/public-agents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/financeiro/entities/[id]/agents — agentes públicos (dados pessoais: permissão de contatos). */
export const GET = route(['contacts.read'], async (ctx) => list(ctx.params['id']!));
/** POST /api/financeiro/entities/[id]/agents */
export const POST = route(['contacts.write'], async (ctx) => create(ctx, ctx.params['id']!, await json(ctx.req, createPublicAgentSchema)));
