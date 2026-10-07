import { Controller, ForbiddenException, Get, Query, StreamableFile } from '@nestjs/common';
import { REPORT_KEYS, reportRequestSchema, type ReportRequest } from '@siow/shared';
import { AuditService } from '../../../common/audit/audit.service.js';
import { Ctx, RequirePermissions, type RequestContext } from '../../../common/auth/decorators.js';
import { zod } from '../../../common/zod/zod.pipe.js';
import { toCsv, toPdf, toXlsx } from './exporters.js';
import { ReportsService } from './reports.service.js';

const REPORT_LABELS: Record<(typeof REPORT_KEYS)[number], string> = {
  financial_overview: 'Financeiro geral',
  invoices: 'Notas fiscais (pendentes / pagas / todas)',
  receivables_by_entity: 'Recebíveis por entidade',
  defaulters: 'Inadimplentes',
  payments: 'Recebimentos',
  average_days_to_pay: 'Tempo médio para recebimento',
  contracts: 'Contratos',
  contracts_expiring: 'Contratos vencendo',
  certificates: 'Certidões (válidas / vencendo / vencidas)',
  service_orders: 'Ordens de serviço',
  tasks: 'Agenda financeira',
  collections: 'Cobranças realizadas',
  invoice_history: 'Histórico financeiro',
};

@Controller('financeiro/reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly audit: AuditService,
  ) {}

  @Get('catalog')
  @RequirePermissions('reports.read')
  catalog() {
    return REPORT_KEYS.map((key) => ({ key, label: REPORT_LABELS[key] }));
  }

  @Get()
  @RequirePermissions('reports.read')
  async run(@Ctx() ctx: RequestContext, @Query(zod(reportRequestSchema)) req: ReportRequest) {
    const result = await this.reports.run(req);
    if (req.format === 'json') return result;
    if (!ctx.user.permissions.includes('reports.export')) throw new ForbiddenException('Permissão necessária: reports.export');
    await this.audit.log(ctx, { action: 'EXPORT', resource: 'report', resourceId: req.report, after: { format: req.format, filters: result.filters } });
    const stamp = result.generatedAt.slice(0, 16).replace(/[:T]/g, '-');
    const name = `${req.report}-${stamp}`;
    if (req.format === 'csv') {
      return new StreamableFile(toCsv(result), { type: 'text/csv; charset=utf-8', disposition: `attachment; filename="${name}.csv"` });
    }
    if (req.format === 'xlsx') {
      const xlsx = await toXlsx(result);
      return new StreamableFile(xlsx, {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        disposition: `attachment; filename="${name}.xlsx"`,
      });
    }
    const pdf = await toPdf(result);
    return new StreamableFile(pdf, { type: 'application/pdf', disposition: `attachment; filename="${name}.pdf"` });
  }
}
