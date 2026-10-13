import { badRequest, route } from '@/server/http';
import { uploadLogo } from '@/server/services/branding';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST multipart (file) — envia o logotipo (PNG/JPEG/SVG/WebP até 1 MB) e grava em branding.logoUrl. */
export const POST = route(['settings.manage'], async (ctx) => {
  const form = await ctx.req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) throw badRequest('Arquivo não enviado');
  return uploadLogo(ctx, file);
});
