import { route } from '@/server/http';
import { board } from '@/server/services/crm/opportunities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/comercial/opportunities/board?pipelineId&ownerUserId — Kanban por etapa. */
export const GET = route(['crm.read'], async (ctx) => board(ctx.query['pipelineId'] || undefined, ctx.query['ownerUserId'] || undefined));
