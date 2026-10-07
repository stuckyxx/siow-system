import { Injectable } from '@nestjs/common';
import { Prisma } from '@siow/db';
import {
  CERTIFICATE_STATUS_LABELS,
  COLLECTION_STATUS_LABELS,
  CONTRACT_STATUS_LABELS,
  INVOICE_STATUS_LABELS,
  SERVICE_ORDER_STATUS_LABELS,
  TASK_STATUS_LABELS,
  TASK_TYPE_LABELS,
  dateToIso,
  daysBetween,
  formatBrDate,
  todayIso,
  toDecimalString,
  type ReportRequest,
} from '@siow/shared';
import { PrismaService } from '../../../common/prisma/prisma.service.js';
import { CertificatesService } from '../certificates/certificates.service.js';
import { buildInvoiceWhere } from '../invoices/invoices.service.js';

export interface ReportColumn {
  key: string;
  label: string;
  type?: 'text' | 'money' | 'date' | 'number';
}

export interface ReportResult {
  key: string;
  title: string;
  generatedAt: string;
  period: string;
  filters: Record<string, unknown>;
  columns: ReportColumn[];
  rows: Array<Record<string, string | number | null>>;
  totals?: Record<string, string | number>;
}

const money = (v: Prisma.Decimal | number | null | undefined): string => toDecimalString(Number(v ?? 0));
const comp = (m: number, y: number): string => `${String(m).padStart(2, '0')}/${y}`;

/** Central de relatórios (spec §24). Todos respeitam os filtros globais. */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly certificates: CertificatesService,
  ) {}

  async run(req: ReportRequest): Promise<ReportResult> {
    const period = this.describePeriod(req);
    const base = { generatedAt: new Date().toISOString(), period, filters: this.cleanFilters(req) };
    const where = buildInvoiceWhere({
      entityId: req.entityId,
      entityType: req.entityType,
      municipality: req.municipality,
      uf: req.uf,
      contractId: req.contractId,
      year: req.year,
      month: req.month,
      competenceFrom: req.competenceFrom,
      competenceTo: req.competenceTo,
      issueFrom: req.dateFrom,
      issueTo: req.dateTo,
      status: req.status,
      responsibleUserId: req.responsibleUserId,
    });
    const entityWhere: Prisma.EntityWhereInput = { deletedAt: null, id: req.entityId, type: req.entityType, uf: req.uf?.toUpperCase(), municipality: req.municipality ? { equals: req.municipality, mode: 'insensitive' } : undefined, responsibleUserId: req.responsibleUserId };

    switch (req.report) {
      case 'invoices':
      case 'invoice_history': {
        const items = await this.prisma.invoice.findMany({ where, include: { entity: true, contract: true, collectionCase: true }, orderBy: [{ entity: { name: 'asc' } }, { competenceYear: 'desc' }, { competenceMonth: 'desc' }] });
        const today = todayIso();
        return {
          ...base,
          key: req.report,
          title: req.report === 'invoices' ? 'Notas fiscais' : 'Histórico financeiro',
          columns: [
            { key: 'entity', label: 'Entidade' }, { key: 'contract', label: 'Contrato' }, { key: 'number', label: 'Nota' }, { key: 'competence', label: 'Competência' },
            { key: 'issueDate', label: 'Emissão', type: 'date' }, { key: 'amount', label: 'Valor', type: 'money' }, { key: 'status', label: 'Situação' },
            { key: 'paidAt', label: 'Pagamento', type: 'date' }, { key: 'daysOpen', label: 'Dias em aberto', type: 'number' }, { key: 'collection', label: 'Cobrança' },
          ],
          rows: items.map((i) => ({
            entity: i.entity.shortName ?? i.entity.name, contract: i.contract?.number ?? '', number: i.number, competence: comp(i.competenceMonth, i.competenceYear),
            issueDate: dateToIso(i.issueDate), amount: money(i.amount), status: INVOICE_STATUS_LABELS[i.status], paidAt: dateToIso(i.paidAt),
            daysOpen: i.status === 'PENDING' && i.issueDate ? daysBetween(dateToIso(i.issueDate)!, today) : null,
            collection: i.collectionCase ? COLLECTION_STATUS_LABELS[i.collectionCase.status] : '',
          })),
          totals: { amount: money(items.reduce((s, i) => s + Number(i.amount), 0)), count: items.length },
        };
      }
      case 'financial_overview':
      case 'receivables_by_entity':
      case 'defaulters': {
        const items = await this.prisma.invoice.findMany({ where, include: { entity: true } });
        const byEntity = new Map<string, { entity: string; type: string; municipality: string; uf: string; pending: number; pendingCount: number; paid: number; paidCount: number; lastPaymentAt: string | null; oldestDays: number }>();
        const today = todayIso();
        for (const i of items) {
          const e = byEntity.get(i.entityId) ?? { entity: i.entity.shortName ?? i.entity.name, type: i.entity.type, municipality: i.entity.municipality, uf: i.entity.uf, pending: 0, pendingCount: 0, paid: 0, paidCount: 0, lastPaymentAt: null, oldestDays: 0 };
          if (i.status === 'PENDING') {
            e.pending += Number(i.amount);
            e.pendingCount += 1;
            if (i.issueDate) e.oldestDays = Math.max(e.oldestDays, daysBetween(dateToIso(i.issueDate)!, today));
          } else if (i.status === 'PAID') {
            e.paid += Number(i.paidAmount ?? i.amount);
            e.paidCount += 1;
            const p = dateToIso(i.paidAt);
            if (p && (!e.lastPaymentAt || p > e.lastPaymentAt)) e.lastPaymentAt = p;
          }
          byEntity.set(i.entityId, e);
        }
        let rows = [...byEntity.values()];
        if (req.report === 'defaulters') rows = rows.filter((r) => r.pending > 0).sort((a, b) => b.oldestDays - a.oldestDays);
        else rows.sort((a, b) => b.pending - a.pending);
        return {
          ...base,
          key: req.report,
          title: req.report === 'defaulters' ? 'Inadimplentes' : req.report === 'financial_overview' ? 'Financeiro geral' : 'Recebíveis por entidade',
          columns: [
            { key: 'entity', label: 'Entidade' }, { key: 'type', label: 'Tipo' }, { key: 'municipality', label: 'Município' }, { key: 'uf', label: 'UF' },
            { key: 'pending', label: 'Em débito', type: 'money' }, { key: 'pendingCount', label: 'Notas pendentes', type: 'number' },
            { key: 'paid', label: 'Recebido', type: 'money' }, { key: 'paidCount', label: 'Notas pagas', type: 'number' },
            { key: 'lastPaymentAt', label: 'Último pagamento', type: 'date' }, { key: 'oldestDays', label: 'Maior atraso (dias)', type: 'number' },
          ],
          rows: rows.map((r) => ({ ...r, pending: toDecimalString(r.pending), paid: toDecimalString(r.paid) })),
          totals: { pending: toDecimalString(rows.reduce((s, r) => s + r.pending, 0)), paid: toDecimalString(rows.reduce((s, r) => s + r.paid, 0)), entities: rows.length },
        };
      }
      case 'payments': {
        const items = await this.prisma.invoice.findMany({ where: { ...where, status: 'PAID' }, include: { entity: true }, orderBy: { paidAt: 'desc' } });
        return {
          ...base, key: req.report, title: 'Recebimentos',
          columns: [{ key: 'paidAt', label: 'Data', type: 'date' }, { key: 'entity', label: 'Entidade' }, { key: 'number', label: 'Nota' }, { key: 'competence', label: 'Competência' }, { key: 'amount', label: 'Valor', type: 'money' }, { key: 'daysToPay', label: 'Dias até o pagamento', type: 'number' }],
          rows: items.map((i) => ({ paidAt: dateToIso(i.paidAt), entity: i.entity.shortName ?? i.entity.name, number: i.number, competence: comp(i.competenceMonth, i.competenceYear), amount: money(i.paidAmount ?? i.amount), daysToPay: i.issueDate && i.paidAt ? daysBetween(dateToIso(i.issueDate)!, dateToIso(i.paidAt)!) : null })),
          totals: { amount: money(items.reduce((s, i) => s + Number(i.paidAmount ?? i.amount), 0)), count: items.length },
        };
      }
      case 'average_days_to_pay': {
        const items = await this.prisma.invoice.findMany({ where: { ...where, status: 'PAID', issueDate: { not: null }, paidAt: { not: null } }, include: { entity: true } });
        const agg = new Map<string, { entity: string; total: number; count: number; max: number }>();
        for (const i of items) {
          const d = daysBetween(dateToIso(i.issueDate)!, dateToIso(i.paidAt)!);
          const a = agg.get(i.entityId) ?? { entity: i.entity.shortName ?? i.entity.name, total: 0, count: 0, max: 0 };
          a.total += d; a.count += 1; a.max = Math.max(a.max, d);
          agg.set(i.entityId, a);
        }
        const rows = [...agg.values()].map((a) => ({ entity: a.entity, average: Math.round(a.total / a.count), max: a.max, count: a.count })).sort((x, y) => y.average - x.average);
        return { ...base, key: req.report, title: 'Tempo médio para recebimento', columns: [{ key: 'entity', label: 'Entidade' }, { key: 'average', label: 'Média (dias)', type: 'number' }, { key: 'max', label: 'Máximo (dias)', type: 'number' }, { key: 'count', label: 'Notas pagas', type: 'number' }], rows, totals: { overallAverage: items.length ? Math.round(rows.reduce((s, r) => s + r.average * r.count, 0) / items.length) : 0 } };
      }
      case 'contracts':
      case 'contracts_expiring': {
        const days = 60;
        const items = await this.prisma.contract.findMany({
          where: { deletedAt: null, entity: entityWhere, id: req.contractId, ...(req.report === 'contracts_expiring' ? { status: 'ACTIVE', endDate: { lte: new Date(Date.now() + days * 86_400_000) } } : {}) },
          include: { entity: true, amendments: true, responsibleUser: true },
          orderBy: { endDate: 'asc' },
        });
        return {
          ...base, key: req.report, title: req.report === 'contracts' ? 'Contratos' : `Contratos vencendo (${days} dias)`,
          columns: [{ key: 'entity', label: 'Entidade' }, { key: 'number', label: 'Contrato' }, { key: 'object', label: 'Objeto' }, { key: 'monthlyValue', label: 'Valor mensal', type: 'money' }, { key: 'startDate', label: 'Início', type: 'date' }, { key: 'endDate', label: 'Fim', type: 'date' }, { key: 'daysLeft', label: 'Dias restantes', type: 'number' }, { key: 'amendments', label: 'Aditivos', type: 'number' }, { key: 'status', label: 'Situação' }, { key: 'responsible', label: 'Responsável' }],
          rows: items.map((c) => ({ entity: c.entity.shortName ?? c.entity.name, number: c.number, object: c.object ?? '', monthlyValue: c.monthlyValue ? money(c.monthlyValue) : null, startDate: dateToIso(c.startDate), endDate: dateToIso(c.endDate), daysLeft: c.endDate ? daysBetween(todayIso(), dateToIso(c.endDate)!) : null, amendments: c.amendments.length, status: CONTRACT_STATUS_LABELS[c.status], responsible: c.responsibleUser?.name ?? '' })),
        };
      }
      case 'certificates': {
        const items = await this.certificates.list(req.entityId);
        return { ...base, key: req.report, title: 'Certidões', columns: [{ key: 'name', label: 'Certidão' }, { key: 'validUntil', label: 'Validade', type: 'date' }, { key: 'days', label: 'Dias restantes', type: 'number' }, { key: 'status', label: 'Situação' }], rows: items.map((c) => ({ name: c.name, validUntil: c.current?.validUntil ?? null, days: c.daysToExpire, status: CERTIFICATE_STATUS_LABELS[c.status] })) };
      }
      case 'service_orders': {
        const items = await this.prisma.serviceOrder.findMany({ where: { deletedAt: null, entityId: req.entityId, contractId: req.contractId, competenceYear: req.year, competenceMonth: req.month, entity: entityWhere }, include: { entity: true, contract: true }, orderBy: [{ competenceYear: 'desc' }, { competenceMonth: 'desc' }] });
        return { ...base, key: req.report, title: 'Ordens de serviço', columns: [{ key: 'entity', label: 'Entidade' }, { key: 'contract', label: 'Contrato' }, { key: 'competence', label: 'Competência' }, { key: 'number', label: 'Número' }, { key: 'status', label: 'Situação' }, { key: 'requestedAt', label: 'Solicitação', type: 'date' }, { key: 'issuedAt', label: 'Emissão', type: 'date' }, { key: 'signedAt', label: 'Assinatura', type: 'date' }], rows: items.map((s) => ({ entity: s.entity.shortName ?? s.entity.name, contract: s.contract.number, competence: comp(s.competenceMonth, s.competenceYear), number: s.number ?? '', status: SERVICE_ORDER_STATUS_LABELS[s.status], requestedAt: dateToIso(s.requestedAt), issuedAt: dateToIso(s.issuedAt), signedAt: dateToIso(s.signedAt) })) };
      }
      case 'tasks': {
        const items = await this.prisma.financialTask.findMany({ where: { deletedAt: null, entityId: req.entityId, assigneeUserId: req.responsibleUserId, dueDate: req.dateFrom || req.dateTo ? { gte: req.dateFrom ? new Date(req.dateFrom) : undefined, lte: req.dateTo ? new Date(req.dateTo) : undefined } : undefined }, include: { entity: true, assignee: true }, orderBy: { dueDate: 'asc' } });
        return { ...base, key: req.report, title: 'Agenda financeira', columns: [{ key: 'dueDate', label: 'Data', type: 'date' }, { key: 'title', label: 'Tarefa' }, { key: 'type', label: 'Tipo' }, { key: 'entity', label: 'Entidade' }, { key: 'assignee', label: 'Responsável' }, { key: 'priority', label: 'Prioridade' }, { key: 'status', label: 'Situação' }], rows: items.map((t) => ({ dueDate: dateToIso(t.dueDate), title: t.title, type: TASK_TYPE_LABELS[t.type], entity: t.entity?.shortName ?? t.entity?.name ?? '', assignee: t.assignee?.name ?? '', priority: t.priority, status: TASK_STATUS_LABELS[t.status] })) };
      }
      case 'collections': {
        const items = await this.prisma.collectionAttempt.findMany({ where: { case: { entityId: req.entityId, entity: entityWhere }, performedAt: req.dateFrom || req.dateTo ? { gte: req.dateFrom ? new Date(req.dateFrom) : undefined, lte: req.dateTo ? new Date(`${req.dateTo}T23:59:59`) : undefined } : undefined }, include: { case: { include: { entity: true, invoice: true } }, performedBy: true, contact: true }, orderBy: { performedAt: 'desc' } });
        return { ...base, key: req.report, title: 'Cobranças realizadas', columns: [{ key: 'performedAt', label: 'Data' }, { key: 'entity', label: 'Entidade' }, { key: 'invoice', label: 'Nota' }, { key: 'channel', label: 'Canal' }, { key: 'contact', label: 'Contato' }, { key: 'user', label: 'Usuário' }, { key: 'status', label: 'Resultado' }, { key: 'nextActionAt', label: 'Próxima ação', type: 'date' }], rows: items.map((a) => ({ performedAt: formatBrDate(a.performedAt) + ' ' + a.performedAt.toISOString().slice(11, 16), entity: a.case.entity.shortName ?? a.case.entity.name, invoice: a.case.invoice.number, channel: a.channel, contact: a.contact?.name ?? '', user: a.performedBy?.name ?? '', status: COLLECTION_STATUS_LABELS[a.resultingStatus], nextActionAt: dateToIso(a.nextActionAt) })) };
      }
      default:
        return { ...base, key: req.report, title: req.report, columns: [], rows: [] };
    }
  }

  private describePeriod(req: ReportRequest): string {
    if (req.competenceFrom || req.competenceTo) return `Competências ${req.competenceFrom ?? '…'} a ${req.competenceTo ?? '…'}`;
    if (req.dateFrom || req.dateTo) return `Período ${req.dateFrom ? formatBrDate(req.dateFrom) : '…'} a ${req.dateTo ? formatBrDate(req.dateTo) : '…'}`;
    if (req.year && req.month) return `Competência ${String(req.month).padStart(2, '0')}/${req.year}`;
    if (req.year) return `Exercício ${req.year}`;
    return 'Todo o período';
  }

  private cleanFilters(req: ReportRequest): Record<string, unknown> {
    const { report: _r, format: _f, ...rest } = req;
    return Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  }
}
