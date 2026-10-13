import { platformRoute } from '@/server/platform-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = platformRoute(async (ctx) => ctx.admin);
