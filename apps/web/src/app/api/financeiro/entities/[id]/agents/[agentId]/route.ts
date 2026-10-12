import { updatePublicAgentSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { remove, update } from '@/server/services/public-agents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PATCH = route(['contacts.write'], async (ctx) => update(ctx, ctx.params['id']!, ctx.params['agentId']!, await json(ctx.req, updatePublicAgentSchema)));
export const DELETE = route(['contacts.write'], async (ctx) => { await remove(ctx, ctx.params['id']!, ctx.params['agentId']!); return { ok: true }; });
