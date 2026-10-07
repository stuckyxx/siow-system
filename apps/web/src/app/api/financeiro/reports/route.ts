import { reportRequestSchema } from '@siow/shared';
import { audit } from '@/server/audit';
import { forbidden, parseQuery, route } from '@/server/http';
import { toCsv, toPdf, toXlsx } from '@/server/reports/exporters';
import { run } from '@/server/services/reports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MIME = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
} as const;

/**
 * GET /api/financeiro/reports?report=&format=json|csv|xlsx|pdf&…filtros globais
 * JSON devolve ReportResult; exportação exige reports.export e é auditada.
 */
export const GET = route(['reports.read'], async (ctx) => {
  const req = parseQuery(ctx.query, reportRequestSchema);
  const result = await run(req);
  if (req.format === 'json') return result;
  if (!ctx.user.permissions.includes('reports.export')) throw forbidden('Permissão necessária: reports.export');
  await audit(ctx, { action: 'EXPORT', resource: 'report', resourceId: req.report, after: { format: req.format, filters: result.filters } });
  const stamp = result.generatedAt.slice(0, 16).replace(/[:T]/g, '-');
  const name = `${req.report}-${stamp}.${req.format}`;
  const buffer = req.format === 'csv' ? toCsv(result) : req.format === 'xlsx' ? await toXlsx(result) : await toPdf(result);
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': MIME[req.format],
      'Content-Disposition': `attachment; filename="${name}"`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'no-store',
    },
  });
});
