import { z } from 'zod';
import { platformJson, platformRoute } from '@/server/platform-auth';
import { platformSetting, setPlatformSetting } from '@/server/services/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Configurações da plataforma: autocadastro e plano padrão. */
export const GET = platformRoute(async () => ({ selfSignup: await platformSetting('platform.selfSignup', false), defaultPlan: await platformSetting('platform.defaultPlan', 'SAAS_BASICO') }));
export const PUT = platformRoute(async (ctx) => {
  const b = await platformJson(ctx.req, z.object({ selfSignup: z.boolean().optional(), defaultPlan: z.string().min(2).max(30).optional() }));
  if (b.selfSignup !== undefined) await setPlatformSetting(ctx, 'platform.selfSignup', b.selfSignup);
  if (b.defaultPlan !== undefined) await setPlatformSetting(ctx, 'platform.defaultPlan', b.defaultPlan);
  return { ok: true };
});
