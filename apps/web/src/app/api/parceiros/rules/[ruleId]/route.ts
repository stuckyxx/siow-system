import { updateCommissionRuleSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { removeRule, updateRule } from '@/server/services/commissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PATCH = route(['partners.manage'], async (ctx) => updateRule(ctx, ctx.params['ruleId']!, await json(ctx.req, updateCommissionRuleSchema)));
export const DELETE = route(['partners.manage'], async (ctx) => { await removeRule(ctx, ctx.params['ruleId']!); return { ok: true }; });
