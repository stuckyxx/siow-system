/**
 * Central de relatórios (spec §24). Todos respeitam os filtros globais.
 *
 * Como cada filtro se aplica fora das notas (onde o significado é direto):
 *  - entityId / entityType / uf / municipality / responsibleUserId → entidade vinculada
 *    (tarefas sem entidade: responsibleUserId também vale para o responsável da tarefa);
 *  - year / month / competenceFrom..To / dateFrom..To → "período":
 *      notas e OS = competência; contratos = vigência cruza o período;
 *      tarefas = vencimento; cobranças = data da tentativa; certidões = validade;
 *  - status (status da NOTA) → notas; OS, tarefas e cobranças filtram pela nota vinculada;
 *      contratos = que possuam nota nesse status no período. Certidões e previsão
 *      não têm nota associada: o filtro de status não se aplica (é informado em `filters`).
 */
import type { Prisma } from '@siow/db';
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
  isoToDate,
  todayIso,
  toDecimalString,
  type ReportRequest,
} from '@siow/shared';
import { prisma } from '../db.js';
import * as certificates from './certificates.js';
import { forecast } from './dashboard.js';
import { buildInvoiceWhere } from './invoices.js';

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

export const REPORT_LABELS: Record<ReportRequest['report'], string> = {
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
  forecast: 'Receita prevista (mensal / anual)',
};

export function catalog(): Array<{ key: string; label: string }> {
  return (Object.keys(REPORT_LABELS) as Array<ReportRequest['report']>).map((key) => ({ key, label: REPORT_LABELS[key] }));
}

const money = (v: Prisma.Decimal | number | null | undefined): string => toDecimalString(Number(v ?? 0));
const comp = (m: number, y: number): string => `${String(m).padStart(2, '0')}/${y}`;

interface Period { from: Date; to: Date }

/** Intervalo de datas (UTC, inclusivo) derivado dos filtros de período. */
function periodRange(req: ReportRequest): Period | null {
  const endOfDay = (iso: string): Date => new Date(isoToDate(iso).getTime() + 86_400_000 - 1);
  const endOfMonth = (y: number, m: number): Date => new Date(Date.UTC(y, m, 1) - 1);
  if (req.dateFrom || req.dateTo) {
    return { from: req.dateFrom ? isoToDate(req.dateFrom) : new Date(Date.UTC(1970, 0, 1)), to: req.dateTo ? endOfDay(req.dateTo) : new Date(Date.UTC(2100, 0, 1)) };
  }
  if (req.competenceFrom || req.competenceTo) {
    const f = req.competenceFrom ? { y: Number(req.competenceFrom.slice(0, 4)), m: Number(req.competenceFrom.slice(5, 7)) } : null;
    const t = req.competenceTo ? { y: Number(req.competenceTo.slice(0, 4)), m: Number(req.competenceTo.slice(5, 7)) } : null;
    return { from: f ? new Date(Date.UTC(f.y, f.m - 1, 1)) : new Date(Date.UTC(1970, 0, 1)), to: t ? endOfMonth(t.y, t.m) : new Date(Date.UTC(2100, 0, 1)) };
  }
  if (req.year && req.month) return { from: new Date(Date.UTC(req.year, req.month - 1, 1)), to: endOfMonth(req.year, req.month) };
  if (req.year) return { from: new Date(Date.UTC(req.year, 0, 1)), to: endOfMonth(req.year, 12) };
  return null;
}

/** Filtro de competência (ano/mês/intervalo) para modelos com competenceMonth/Year (OS). */
function competenceWhere(req: ReportRequest): Prisma.ServiceOrderWhereInput {
  const w: Prisma.ServiceOrderWhereInput = { competenceYear: req.year, competenceMonth: req.month };
  const range: Prisma.ServiceOrderWhereInput[] = [];
  if (req.competenceFrom) { const y = Number(req.competenceFrom.slice(0, 4)); const m = Number(req.competenceFrom.slice(5, 7)); range.push({ OR: [{ competenceYear: { gt: y } }, { competenceYear: y, competenceMonth: { gte: m } }] }); }
  if (req.competenceTo) { const y = Number(req.competenceTo.slice(0, 4)); const m = Number(req.competenceTo.slice(5, 7)); range.push({ OR: [{ competenceYear: { lt: y } }, { competenceYear: y, competenceMonth: { lte: m } }] }); }
  if (range.length) w.AND = range;
  return w;
}

const invoiceStatus = (req: ReportRequest): Prisma.InvoiceWhereInput | undefined => (req.status && req.status !== 'ALL' ? { status: req.status, deletedAt: null } : undefined);

function describePeriod(req: ReportRequest): string {
  if (req.competenceFrom || req.competenceTo) return `Competências ${req.competenceFrom ?? '…'} a ${req.competenceTo ?? '…'}`;
  if (req.dateFrom || req.dateTo) return `Período ${req.dateFrom ? formatBrDate(req.dateFrom) : '…'} a ${req.dateTo ? formatBrDate(req.dateTo) : '…'}`;
  if (req.year && req.month) return `Competência ${String(req.month).padStart(2, '0')}/${req.year}`;
  if (req.year) return `Exercício ${req.year}`;
  return 'Todo o período';
}

function cleanFilters(req: ReportRequest): Record<string, unknown> {
  const { report: _r, format: _f, ...rest } = req;
  return Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
}

export async function run(req: ReportRequest): Promise<ReportResult> {
  const period = describePeriod(req);
  const base = { generatedAt: new Date().toISOString(), period, filters: cleanFilters(req) };
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
  const hasEntityFilter = Boolean(req.entityId || req.entityType || req.uf || req.municipality || req.responsibleUserId);
  const range = periodRange(req);
  const today = todayIso();

  switch (req.report) {
    case 'invoices':
    case 'invoice_history': {
      const items = await prisma.invoice.findMany({ where, include: { entity: true, contract: true, collectionCase: true }, orderBy: [{ entity: { name: 'asc' } }, { competenceYear: 'desc' }, { competenceMonth: 'desc' }] });
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
      const items = await prisma.invoice.findMany({ where, include: { entity: true } });
      const byEntity = new Map<string, { entity: string; type: string; municipality: string; uf: string; pending: number; pendingCount: number; paid: number; paidCount: number; lastPaymentAt: string | null; oldestDays: number }>();
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
      const items = await prisma.invoice.findMany({ where: { ...where, status: 'PAID' }, include: { entity: true }, orderBy: { paidAt: 'desc' } });
      return {
        ...base, key: req.report, title: 'Recebimentos',
        columns: [{ key: 'paidAt', label: 'Data', type: 'date' }, { key: 'entity', label: 'Entidade' }, { key: 'number', label: 'Nota' }, { key: 'competence', label: 'Competência' }, { key: 'amount', label: 'Valor', type: 'money' }, { key: 'daysToPay', label: 'Dias até o pagamento', type: 'number' }],
        rows: items.map((i) => ({ paidAt: dateToIso(i.paidAt), entity: i.entity.shortName ?? i.entity.name, number: i.number, competence: comp(i.competenceMonth, i.competenceYear), amount: money(i.paidAmount ?? i.amount), daysToPay: i.issueDate && i.paidAt ? daysBetween(dateToIso(i.issueDate)!, dateToIso(i.paidAt)!) : null })),
        totals: { amount: money(items.reduce((s, i) => s + Number(i.paidAmount ?? i.amount), 0)), count: items.length },
      };
    }
    case 'average_days_to_pay': {
      const items = await prisma.invoice.findMany({ where: { ...where, status: 'PAID', issueDate: { not: null }, paidAt: { not: null } }, include: { entity: true } });
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
      const invoiceFilter = invoiceStatus(req);
      const items = await prisma.contract.findMany({
        where: {
          deletedAt: null,
          entity: entityWhere,
          id: req.contractId,
          // vigência cruza o período filtrado
          ...(range ? { AND: [{ OR: [{ startDate: null }, { startDate: { lte: range.to } }] }, { OR: [{ endDate: null }, { endDate: { gte: range.from } }] }] } : {}),
          ...(invoiceFilter ? { invoices: { some: { ...where, ...invoiceFilter } } } : {}),
          ...(req.report === 'contracts_expiring' ? { status: 'ACTIVE', endDate: { lte: new Date(Date.now() + days * 86_400_000) } } : {}),
        },
        include: { entity: true, amendments: true, responsibleUser: true },
        orderBy: { endDate: 'asc' },
      });
      return {
        ...base, key: req.report, title: req.report === 'contracts' ? 'Contratos' : `Contratos vencendo (${days} dias)`,
        columns: [{ key: 'entity', label: 'Entidade' }, { key: 'number', label: 'Contrato' }, { key: 'object', label: 'Objeto' }, { key: 'monthlyValue', label: 'Valor mensal', type: 'money' }, { key: 'startDate', label: 'Início', type: 'date' }, { key: 'endDate', label: 'Fim', type: 'date' }, { key: 'daysLeft', label: 'Dias restantes', type: 'number' }, { key: 'amendments', label: 'Aditivos', type: 'number' }, { key: 'status', label: 'Situação' }, { key: 'responsible', label: 'Responsável' }],
        rows: items.map((c) => ({ entity: c.entity.shortName ?? c.entity.name, number: c.number, object: c.object ?? '', monthlyValue: c.monthlyValue ? money(c.monthlyValue) : null, startDate: dateToIso(c.startDate), endDate: dateToIso(c.endDate), daysLeft: c.endDate ? daysBetween(today, dateToIso(c.endDate)!) : null, amendments: c.amendments.length, status: CONTRACT_STATUS_LABELS[c.status], responsible: c.responsibleUser?.name ?? '' })),
        totals: { monthlyValue: money(items.reduce((s, c) => s + Number(c.monthlyValue ?? 0), 0)), count: items.length },
      };
    }
    case 'certificates': {
      let items = await certificates.list(req.entityId);
      if (hasEntityFilter && !req.entityId) {
        // certidões da empresa (entityId null) sempre entram; as específicas só das entidades que batem com o filtro
        const ids = new Set((await prisma.entity.findMany({ where: entityWhere, select: { id: true } })).map((e) => e.id));
        items = items.filter((c) => c.entityId === null || ids.has(c.entityId));
      }
      if (range) items = items.filter((c) => c.current?.validUntil && isoToDate(c.current.validUntil) >= range.from && isoToDate(c.current.validUntil) <= range.to);
      return { ...base, key: req.report, title: 'Certidões', columns: [{ key: 'name', label: 'Certidão' }, { key: 'validUntil', label: 'Validade', type: 'date' }, { key: 'days', label: 'Dias restantes', type: 'number' }, { key: 'status', label: 'Situação' }], rows: items.map((c) => ({ name: c.name, validUntil: c.current?.validUntil ?? null, days: c.daysToExpire, status: CERTIFICATE_STATUS_LABELS[c.status] })), totals: { count: items.length, expiring: items.filter((c) => c.status === 'EXPIRING').length, expired: items.filter((c) => c.status === 'EXPIRED').length } };
    }
    case 'service_orders': {
      const invoiceFilter = invoiceStatus(req);
      const items = await prisma.serviceOrder.findMany({
        where: { deletedAt: null, entityId: req.entityId, contractId: req.contractId, entity: entityWhere, ...competenceWhere(req), ...(invoiceFilter ? { invoice: invoiceFilter } : {}) },
        include: { entity: true, contract: true },
        orderBy: [{ competenceYear: 'desc' }, { competenceMonth: 'desc' }],
      });
      return { ...base, key: req.report, title: 'Ordens de serviço', columns: [{ key: 'entity', label: 'Entidade' }, { key: 'contract', label: 'Contrato' }, { key: 'competence', label: 'Competência' }, { key: 'number', label: 'Número' }, { key: 'status', label: 'Situação' }, { key: 'requestedAt', label: 'Solicitação', type: 'date' }, { key: 'issuedAt', label: 'Emissão', type: 'date' }, { key: 'signedAt', label: 'Assinatura', type: 'date' }], rows: items.map((s) => ({ entity: s.entity.shortName ?? s.entity.name, contract: s.contract.number, competence: comp(s.competenceMonth, s.competenceYear), number: s.number ?? '', status: SERVICE_ORDER_STATUS_LABELS[s.status], requestedAt: dateToIso(s.requestedAt), issuedAt: dateToIso(s.issuedAt), signedAt: dateToIso(s.signedAt) })), totals: { count: items.length } };
    }
    case 'tasks': {
      const invoiceFilter = invoiceStatus(req);
      const { responsibleUserId: _r, ...entityNoResp } = entityWhere;
      const hasEntityScope = Boolean(req.entityId || req.entityType || req.uf || req.municipality);
      const items = await prisma.financialTask.findMany({
        where: {
          deletedAt: null,
          entityId: req.entityId,
          contractId: req.contractId,
          ...(hasEntityScope ? { entity: entityNoResp } : {}),
          ...(req.responsibleUserId ? { OR: [{ assigneeUserId: req.responsibleUserId }, { entity: { responsibleUserId: req.responsibleUserId } }] } : {}),
          dueDate: range ? { gte: range.from, lte: range.to } : undefined,
          ...(invoiceFilter ? { invoice: invoiceFilter } : {}),
        },
        include: { entity: true, assignee: true },
        orderBy: { dueDate: 'asc' },
      });
      return { ...base, key: req.report, title: 'Agenda financeira', columns: [{ key: 'dueDate', label: 'Data', type: 'date' }, { key: 'title', label: 'Tarefa' }, { key: 'type', label: 'Tipo' }, { key: 'entity', label: 'Entidade' }, { key: 'assignee', label: 'Responsável' }, { key: 'priority', label: 'Prioridade' }, { key: 'status', label: 'Situação' }], rows: items.map((t) => ({ dueDate: dateToIso(t.dueDate), title: t.title, type: TASK_TYPE_LABELS[t.type], entity: t.entity?.shortName ?? t.entity?.name ?? '', assignee: t.assignee?.name ?? '', priority: t.priority, status: TASK_STATUS_LABELS[t.status] })), totals: { count: items.length } };
    }
    case 'collections': {
      const invoiceFilter = invoiceStatus(req);
      const items = await prisma.collectionAttempt.findMany({
        where: {
          case: { entityId: req.entityId, entity: entityWhere, ...(req.contractId || invoiceFilter ? { invoice: { contractId: req.contractId, ...(invoiceFilter ?? {}) } } : {}) },
          performedAt: range ? { gte: range.from, lte: range.to } : undefined,
        },
        include: { case: { include: { entity: true, invoice: true } }, performedBy: true, contact: true },
        orderBy: { performedAt: 'desc' },
      });
      return { ...base, key: req.report, title: 'Cobranças realizadas', columns: [{ key: 'performedAt', label: 'Data' }, { key: 'entity', label: 'Entidade' }, { key: 'invoice', label: 'Nota' }, { key: 'channel', label: 'Canal' }, { key: 'contact', label: 'Contato' }, { key: 'user', label: 'Usuário' }, { key: 'status', label: 'Resultado' }, { key: 'nextActionAt', label: 'Próxima ação', type: 'date' }], rows: items.map((a) => ({ performedAt: formatBrDate(a.performedAt) + ' ' + a.performedAt.toISOString().slice(11, 16), entity: a.case.entity.shortName ?? a.case.entity.name, invoice: a.case.invoice.number, channel: a.channel, contact: a.contact?.name ?? '', user: a.performedBy?.name ?? '', status: COLLECTION_STATUS_LABELS[a.resultingStatus], nextActionAt: dateToIso(a.nextActionAt) })), totals: { count: items.length } };
    }
    case 'forecast': {
      // Receita prevista: contratos ATIVOS respeitando entidade/tipo/município/UF/responsável/contrato.
      // Período e status da nota não se aplicam (projeção a partir da última nota emitida ou do valor contratual).
      const f = await forecast({ entityId: req.entityId, entityType: req.entityType, municipality: req.municipality, uf: req.uf, responsibleUserId: req.responsibleUserId, contractId: req.contractId });
      return {
        ...base, key: req.report, title: 'Receita prevista (mensal / anual)',
        columns: [{ key: 'entity', label: 'Entidade' }, { key: 'contract', label: 'Contrato' }, { key: 'lastInvoice', label: 'Última nota' }, { key: 'lastCompetence', label: 'Competência' }, { key: 'lastIssuedAt', label: 'Emissão', type: 'date' }, { key: 'monthly', label: 'Previsto mensal', type: 'money' }, { key: 'annual', label: 'Previsto anual', type: 'money' }],
        rows: f.forecastRows.map((r) => ({ entity: r.entityShort, contract: r.contractNumber, lastInvoice: r.lastInvoice?.number ?? '', lastCompetence: r.lastInvoice ? `${r.lastInvoice.competence.slice(5, 7)}/${r.lastInvoice.competence.slice(0, 4)}` : '', lastIssuedAt: r.lastInvoice?.issuedAt ?? null, monthly: r.monthly, annual: r.annual })),
        totals: { monthly: f.forecastMonthly, annual: f.forecastAnnual, contracts: f.forecastRows.length },
      };
    }
    default:
      return { ...base, key: req.report, title: req.report, columns: [], rows: [] };
  }
}
