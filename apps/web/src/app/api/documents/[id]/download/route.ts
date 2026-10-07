import { NextResponse } from 'next/server';
import { route } from '@/server/http';
import { prisma } from '@/server/db';
import { downloadUrl } from '@/server/services/documents';
import { fetchBlob, isDirectUrl } from '@/server/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/documents/[id]/download — redireciona (302) para a URL do blob.
 * Com ?inline=0 faz streaming do conteúdo com Content-Disposition: attachment (nome original).
 */
export const GET = route(['documents.read'], async (ctx) => {
  const d = await downloadUrl(ctx, ctx.params['id']!);
  const doc = await prisma.document.findUnique({ where: { id: ctx.params['id']! }, include: { blob: true } });
  const key = doc!.blob.storageKey;
  if (ctx.query['inline'] !== '0' && isDirectUrl(key)) return NextResponse.redirect(d.url, 302);
  const upstream = await fetchBlob(key);
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': d.mimeType,
      'Content-Length': String(d.size),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(d.name)}`,
      'Cache-Control': 'private, no-store',
    },
  });
});
