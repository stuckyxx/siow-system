import { commissionRuleSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { createRule, listRules } from '@/server/services/commissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(['partners.read'], async (ctx) => listRules(ctx.params['id']!));
export const POST = route(['partners.manage'], async (ctx) => createRule(ctx, ctx.params['id']!, await json(ctx.req, commissionRuleSchema)));
