import { route } from '@/server/http';
import { brandingForHost } from '@/server/services/branding';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/public/branding?host= — marca (nome, logo, cores) da organização dona do domínio; padrão Siow. */
export const GET = route(null, async (ctx) => brandingForHost(ctx.query['host'] ?? ctx.req.headers.get('x-forwarded-host') ?? ctx.req.headers.get('host') ?? ''));
