import { route } from '@/server/http';
import { buildImportWorkbook } from '@/server/services/import-template';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/financeiro/entities/import-template[?url=…] — modelo XLSX de importação.
 * Com `url` (link web do Portal do Cliente), vem preenchido com a(s) entidade(s) e todas as notas do link.
 */
export const GET = route(['entities.write'], async (ctx) => {
  const url = ctx.query['url']?.trim() || null;
  const { buffer, fileName } = await buildImportWorkbook(url);
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    },
  });
});
