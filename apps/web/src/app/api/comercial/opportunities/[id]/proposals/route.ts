import { createProposalSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { create, list } from '@/server/services/crm/proposals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET — versões da proposta da oportunidade (mais recente primeiro). POST — nova versão. */
export const GET = route(['crm.read'], async (ctx) => list(ctx.params['id']!));
export const POST = route(['crm.write'], async (ctx) => create(ctx, ctx.params['id']!, await json(ctx.req, createProposalSchema)));
