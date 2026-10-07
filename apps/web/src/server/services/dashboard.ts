/**
 * Dashboard financeiro: cards, série mensal, aging, maiores devedores,
 * pagamentos recentes, itens de atenção, previsão de faturamento e opções de filtro.
 */
import type { Prisma } from '@siow/db';
import {
  AGING_BUCKETS,
  addDaysIso,
  agingBucket,
  dateToIso,
  daysBetween,
  isoToDate,
  todayIso,
  toDecimalString,
  type AgingPoint,
  type AttentionItem,
  type DashboardFilter,
  type DashboardResponse,
  type MonthlySeriesPoint,
  type RecentPayment,
  type TopDebtor,
} from '@siow/shared';
import { prisma } from '../db.js';
import { buildInvoiceWhere } from './invoices.js';

export interface ForecastRow {
  entityId: string;
  entityShort: string;
  contractId: string;
  contractNumber: string;
  lastInvoice: { number: string; competence: string; issuedAt: string | null } | null;
  monthly: string;
  annual: string;
}

export interface Forecast {
  /** Soma do valor mensal previsto dos contratos ativos (última nota emitida ou valor contratual). */
  forecastMonthly: string;
  /** forecastMonthly × 12. */
  forecastAnnual: string;
  forecastRows: ForecastRow[];
}

export type DashboardWithForecast = DashboardResponse & Forecast;

async function setting(key: string, fallback: number): Promise<number> {
  const s = await prisma.setting.findUnique({ where: { key } });
  return typeof s?.value === 'number' ? s.value : fallback;
}

/**
 * Previsão de faturamento: para cada contrato ATIVO (respeitando os filtros de
 * entidade/tipo/município/UF/responsável/contrato), o valor mensal é o da nota
 * emitida mais recentemente (não cancelada); sem nota, usa o valor contratual.
 */
export async function forecast(f: Pick<DashboardFilter, 'entityId' | 'entityType' | 'municipality' | 'uf' | 'responsibleUserId' | 'contractId'>): Promise<Forecast> {
  const entity: Prisma.EntityWhereInput = { deletedAt: null };
  if (f.entityType) entity.type = f.entityType;
  if (f.uf) entity.uf = f.uf.toUpperCase();
  if (f.municipality) entity.municipality = { equals: f.municipality, mode: 'insensitive' };
  if (f.responsibleUserId) entity.responsibleUserId = f.responsibleUserId;
  const contracts = await prisma.contract.findMany({
    where: { deletedAt: null, status: 'ACTIVE', entityId: f.entityId, id: f.contractId, entity },
    select: {
      id: true,
      number: true,
      entityId: true,
      monthlyValue: true,
      entity: { select: { name: true, shortName: true } },
      invoices: {
        where: { deletedAt: null, status: { not: 'CANCELLED' } },
        orderBy: [{ issueDate: { sort: 'desc', nulls: 'last' } }, { competenceYear: 'desc' }, { competenceMonth: 'desc' }],
        take: 1,
        select: { number: true, amount: true, issueDate: true, competenceMonth: true, competenceYear: true },
      },
    },
    orderBy: [{ entity: { name: 'asc' } }, { number: 'asc' }],
  });
  let totalMonthly = 0;
  const rows: ForecastRow[] = contracts.map((c) => {
    const last = c.invoices[0] ?? null;
    const monthly = last ? Number(last.amount) : c.monthlyValue ? Number(c.monthlyValue) : 0;
    totalMonthly += monthly;
    return {
      entityId: c.entityId,
      entityShort: c.entity.shortName ?? c.entity.name,
      contractId: c.id,
      contractNumber: c.number,
      lastInvoice: last ? { number: last.number, competence: `${last.competenceYear}-${String(last.competenceMonth).padStart(2, '0')}`, issuedAt: dateToIso(last.issueDate) } : null,
      monthly: toDecimalString(monthly),
      annual: toDecimalString(monthly * 12),
    };
  });
  return { forecastMonthly: toDecimalString(totalMonthly), forecastAnnual: toDecimalString(totalMonthly * 12), forecastRows: rows };
}

export async function build(f: DashboardFilter): Promise<DashboardWithForecast> {
  const today = todayIso();
  const [overdueAfter, certDays, contractDays] = await Promise.all([
    setting('invoices.overdueAfterDays', 30),
    setting('certificates.expiringDays', 30),
    setting('contracts.expiringDays', 60),
  ]);

  const where = buildInvoiceWhere({
    entityId: f.entityId,
    entityType: f.entityType,
    municipality: f.municipality,
    uf: f.uf,
    contractId: f.contractId,
    year: f.year,
    month: f.month,
    competenceFrom: f.competenceFrom,
    competenceTo: f.competenceTo,
    issueFrom: f.dateFrom,
    issueTo: f.dateTo,
    status: f.status,
    responsibleUserId: f.responsibleUserId,
  });

  const invoices = await prisma.invoice.findMany({
    where,
    select: {
      id: true,
      number: true,
      entityId: true,
      amount: true,
      paidAmount: true,
      status: true,
      issueDate: true,
      paidAt: true,
      competenceMonth: true,
      competenceYear: true,
      needsReconciliation: true,
      entity: { select: { name: true, shortName: true, type: true, municipality: true, uf: true } },
    },
  });

  // ---- cards ----
  let totalReceivable = 0;
  let totalReceived = 0;
  let pendingCount = 0;
  let paidCount = 0;
  let reconciliation = 0;
  const debtByEntity = new Map<string, TopDebtor>();
  const monthly = new Map<string, { received: number; pending: number; issued: number }>();
  const aging = new Map<string, { count: number; amount: number }>(AGING_BUCKETS.map((b) => [b, { count: 0, amount: 0 }]));
  const payments: RecentPayment[] = [];
  const oldPending: AttentionItem[] = [];

  for (const inv of invoices) {
    const amount = Number(inv.amount);
    const comp = `${inv.competenceYear}-${String(inv.competenceMonth).padStart(2, '0')}`;
    let m = monthly.get(comp);
    if (!m) {
      m = { received: 0, pending: 0, issued: 0 };
      monthly.set(comp, m);
    }
    if (inv.status !== 'CANCELLED') m.issued += amount;
    if (inv.needsReconciliation) reconciliation += 1;
    if (inv.status === 'PENDING') {
      totalReceivable += amount;
      pendingCount += 1;
      m.pending += amount;
      const issue = dateToIso(inv.issueDate);
      const days = issue ? daysBetween(issue, today) : 0;
      const bucket = aging.get(agingBucket(days))!;
      bucket.count += 1;
      bucket.amount += amount;
      const d = debtByEntity.get(inv.entityId) ?? {
        entityId: inv.entityId,
        entityName: inv.entity.shortName ?? inv.entity.name,
        entityType: inv.entity.type,
        municipality: inv.entity.municipality,
        uf: inv.entity.uf,
        debt: '0',
        pendingInvoices: 0,
        oldestPendingDays: null,
      };
      d.debt = toDecimalString(Number(d.debt) + amount);
      d.pendingInvoices += 1;
      d.oldestPendingDays = Math.max(d.oldestPendingDays ?? 0, days);
      debtByEntity.set(inv.entityId, d);
      if (days > 90) {
        oldPending.push({
          kind: 'OLD_INVOICE',
          title: `NF ${inv.number} de ${inv.entity.shortName ?? inv.entity.name} pendente há ${days} dias`,
          detail: `Competência ${comp.split('-').reverse().join('/')} — ${toDecimalString(amount)}`,
          entityId: inv.entityId,
          referenceId: inv.id,
          severity: 'high',
          date: issue,
        });
      }
    } else if (inv.status === 'PAID') {
      const paid = Number(inv.paidAmount ?? inv.amount);
      totalReceived += paid;
      paidCount += 1;
      const paidIso = dateToIso(inv.paidAt);
      if (paidIso) {
        const pm = paidIso.slice(0, 7);
        // Mês do pagamento pode ser o mesmo da competência: reutiliza o registro já existente.
        let rec = monthly.get(pm);
        if (!rec) {
          rec = { received: 0, pending: 0, issued: 0 };
          monthly.set(pm, rec);
        }
        rec.received += paid;
        payments.push({ invoiceId: inv.id, entityId: inv.entityId, entityName: inv.entity.shortName ?? inv.entity.name, amount: toDecimalString(paid), paidAt: paidIso, competence: comp, number: inv.number });
      }
    }
  }

  void overdueAfter;

  const [activeContracts, contractsExpiring, certVersions, pendingServiceOrders, failedSyncs, overdueCollections, fc] = await Promise.all([
    prisma.contract.count({ where: { deletedAt: null, status: 'ACTIVE', entityId: f.entityId } }),
    prisma.contract.findMany({
      where: { deletedAt: null, status: 'ACTIVE', entityId: f.entityId, endDate: { lte: isoToDate(addDaysIso(today, contractDays)) } },
      include: { entity: { select: { name: true, shortName: true } } },
    }),
    prisma.certificateVersion.findMany({
      where: { isCurrent: true, certificate: { isActive: true, deletedAt: null }, validUntil: { lte: isoToDate(addDaysIso(today, certDays)) } },
      include: { certificate: true },
    }),
    prisma.serviceOrder.findMany({
      where: { deletedAt: null, entityId: f.entityId, status: { in: ['NOT_REQUESTED', 'REQUESTED', 'AWAITING_ISSUE', 'AWAITING_SIGNATURE'] } },
      include: { entity: { select: { name: true, shortName: true } } },
      take: 20,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.dataSource.findMany({ where: { deletedAt: null, lastSyncStatus: 'FAILED', entityId: f.entityId }, include: { entity: { select: { name: true, shortName: true } } } }),
    prisma.collectionCase.findMany({
      where: { entityId: f.entityId, status: { notIn: ['SETTLED'] }, nextActionAt: { lt: isoToDate(today) } },
      include: { entity: { select: { name: true, shortName: true } }, invoice: { select: { number: true } } },
      take: 20,
    }),
    forecast(f),
  ]);

  const attention: AttentionItem[] = [
    ...oldPending.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')).slice(0, 15),
    ...contractsExpiring.map<AttentionItem>((c) => ({
      kind: 'CONTRACT_EXPIRING',
      title: `Contrato ${c.number} — ${c.entity.shortName ?? c.entity.name}`,
      detail: `Vence em ${dateToIso(c.endDate)?.split('-').reverse().join('/')}`,
      entityId: c.entityId,
      referenceId: c.id,
      severity: (c.endDate && dateToIso(c.endDate)! < today) ? 'high' : 'warning',
      date: dateToIso(c.endDate),
    })),
    ...certVersions.map<AttentionItem>((v) => {
      const until = dateToIso(v.validUntil)!;
      const expired = until < today;
      return {
        kind: expired ? 'CERTIFICATE_EXPIRED' : 'CERTIFICATE_EXPIRING',
        title: `${expired ? 'Certidão vencida' : 'Certidão vencendo'}: ${v.certificate.name}`,
        detail: `Validade ${until.split('-').reverse().join('/')}`,
        entityId: v.certificate.entityId,
        referenceId: v.certificateId,
        severity: expired ? 'high' : 'warning',
        date: until,
      };
    }),
    ...pendingServiceOrders.map<AttentionItem>((so) => ({
      kind: 'SERVICE_ORDER_PENDING',
      title: `OS ${String(so.competenceMonth).padStart(2, '0')}/${so.competenceYear} — ${so.entity.shortName ?? so.entity.name}`,
      detail: `Situação: ${so.status}`,
      entityId: so.entityId,
      referenceId: so.id,
      severity: 'info',
      date: null,
    })),
    ...overdueCollections.map<AttentionItem>((cc) => ({
      kind: 'COLLECTION_OVERDUE',
      title: `Cobrança atrasada — NF ${cc.invoice.number} (${cc.entity.shortName ?? cc.entity.name})`,
      detail: cc.nextActionNote ?? `Próxima ação prevista para ${dateToIso(cc.nextActionAt)?.split('-').reverse().join('/')}`,
      entityId: cc.entityId,
      referenceId: cc.invoiceId,
      severity: 'warning',
      date: dateToIso(cc.nextActionAt),
    })),
    ...failedSyncs.map<AttentionItem>((ds) => ({
      kind: 'SYNC_FAILED',
      title: `Sincronização falhou — ${ds.entity.shortName ?? ds.entity.name}`,
      detail: ds.circuitOpenUntil ? `Pausada até ${ds.circuitOpenUntil.toLocaleString('pt-BR')}` : 'Verificar fonte de dados',
      entityId: ds.entityId,
      referenceId: ds.id,
      severity: 'warning',
      date: ds.lastSyncAt ? dateToIso(ds.lastSyncAt) : null,
    })),
  ];
  if (reconciliation > 0) {
    attention.unshift({ kind: 'RECONCILIATION', title: `${reconciliation} nota(s) precisam de verificação`, detail: 'Divergências entre a fonte e o cadastro', entityId: f.entityId ?? null, referenceId: null, severity: 'warning', date: today });
  }

  const monthlySeries: MonthlySeriesPoint[] = [...monthly.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-24)
    .map(([competence, v]) => ({ competence, received: toDecimalString(v.received), pending: toDecimalString(v.pending), issued: toDecimalString(v.issued) }));

  const agingPoints: AgingPoint[] = AGING_BUCKETS.map((b) => ({ bucket: b, count: aging.get(b)!.count, amount: toDecimalString(aging.get(b)!.amount) }));

  return {
    generatedAt: new Date().toISOString(),
    cards: {
      totalReceivable: toDecimalString(totalReceivable),
      totalReceived: toDecimalString(totalReceived),
      totalDebt: toDecimalString(totalReceivable),
      pendingInvoices: pendingCount,
      paidInvoices: paidCount,
      entitiesWithDebt: debtByEntity.size,
      activeContracts,
      contractsExpiring: contractsExpiring.length,
      certificatesExpiring: certVersions.length,
      needsReconciliation: reconciliation,
    },
    monthly: monthlySeries,
    aging: agingPoints,
    topDebtors: [...debtByEntity.values()].sort((a, b) => Number(b.debt) - Number(a.debt)).slice(0, 20),
    recentPayments: payments.sort((a, b) => b.paidAt.localeCompare(a.paidAt)).slice(0, 15),
    attention,
    ...fc,
  };
}

/** Opções para os filtros globais (entidades, municípios, UFs, exercícios, contratos, responsáveis). */
export async function filterOptions() {
  const [entities, years, users] = await Promise.all([
    prisma.entity.findMany({ where: { deletedAt: null }, select: { id: true, name: true, shortName: true, type: true, municipality: true, uf: true, contracts: { where: { deletedAt: null }, select: { id: true, number: true } } }, orderBy: { name: 'asc' } }),
    prisma.invoice.findMany({ where: { deletedAt: null }, distinct: ['competenceYear'], select: { competenceYear: true }, orderBy: { competenceYear: 'desc' } }),
    prisma.user.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  return {
    entities,
    municipalities: [...new Set(entities.map((e) => e.municipality))].sort(),
    ufs: [...new Set(entities.map((e) => e.uf))].sort(),
    years: years.map((y) => y.competenceYear),
    users,
  };
}
