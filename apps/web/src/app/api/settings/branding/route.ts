import { brandingSchema } from '@siow/shared';
import { json, route } from '@/server/http';
import { getBranding, updateBranding } from '@/server/services/branding';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Marca da organização (white-label): GET / PUT { productName, tagline, logoUrl, accent, accent2, supportEmail }. */
export const GET = route(['settings.manage'], async () => getBranding());
export const PUT = route(['settings.manage'], async (ctx) => updateBranding(ctx, await json(ctx.req, brandingSchema)));
