import { platformLoginSchema } from '@siow/shared';
import { platformJson, platformLogin, platformRoute } from '@/server/platform-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/platform/auth/login — superadmin da plataforma (PlatformAdmin). Define cookie HttpOnly siow_platform. */
export const POST = platformRoute(async (ctx) => { const b = await platformJson(ctx.req, platformLoginSchema); return { ok: true, admin: await platformLogin(b.email, b.password) }; }, { auth: false });
