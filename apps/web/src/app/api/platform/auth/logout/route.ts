import { platformLogout, platformRoute } from '@/server/platform-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = platformRoute(async () => { await platformLogout(); return { ok: true }; }, { auth: false });
