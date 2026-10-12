import type {
  AgingBucket,
  CertificateStatus,
  CollectionStatus,
  ContractStatus,
  EntityType,
  InvoiceStatus,
  SyncStatus,
} from './enums.js';

/** Resposta paginada padrão da API. */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  roles: string[];
  permissions: string[];
  organizationId: string;
  organization: { id: string; name: string; slug: string; branding: Record<string, unknown> };
}

export interface EntitySummary {
  id: string;
  type: EntityType;
  name: string;
  shortName: string | null;
  municipality: string;
  uf: string;
  isActive: boolean;
  activeContractNumber: string | null;
  activeContractEndDate: string | null;
  debtTotal: string; // decimal string
  pendingInvoices: number;
  /** notas pagas (quantidade) e total recebido (decimal string) */
  paidInvoices: number;
  paidTotal: string;
  lastPaymentAt: string | null;
  lastPaymentAmount: string | null;
  lastCollectionAt: string | null;
  collectionStatus: CollectionStatus | null;
  pendingServiceOrders: number;
  lastSyncAt: string | null;
  lastSyncStatus: SyncStatus | null;
  needsReconciliation: number;
  /** totais para filtros da lista: contratos (qualquer status), notas (qualquer status) e fontes (links) cadastradas */
  contractCount: number;
  invoiceCount: number;
  sourceCount: number;
  /** Cadastro Público */
  ibgeCode: string | null;
  segment: string | null;
  partnerId: string | null;
  /** Saúde do cliente 0–100 (null = sem dados suficientes) */
  healthScore: number | null;
  /** Ciclo de vida derivado: LEAD (sem contrato/nota), CLIENTE (contrato ativo), EX_CLIENTE (só contratos encerrados), PROSPECT (reservado ao CRM) */
  lifecycle: EntityLifecycle;
}
export type EntityLifecycle = 'LEAD' | 'PROSPECT' | 'CLIENTE' | 'EX_CLIENTE';
export const ENTITY_LIFECYCLE_LABELS: Record<EntityLifecycle, string> = { LEAD: 'Lead', PROSPECT: 'Prospect', CLIENTE: 'Cliente', EX_CLIENTE: 'Ex-cliente' };

export interface InvoiceRow {
  id: string;
  entityId: string;
  entityName: string;
  entityType: EntityType;
  contractId: string | null;
  contractNumber: string | null;
  number: string;
  competenceMonth: number;
  competenceYear: number;
  amount: string;
  issueDate: string | null;
  status: InvoiceStatus;
  paidAt: string | null;
  daysOverdue: number | null;
  needsReconciliation: boolean;
  manualOverride: boolean;
  collectionStatus: CollectionStatus | null;
  hasDocument: boolean;
}

export interface DashboardCards {
  totalReceivable: string;
  totalReceived: string;
  totalDebt: string;
  pendingInvoices: number;
  paidInvoices: number;
  entitiesWithDebt: number;
  /** Entidades cadastradas (ativas, não excluídas) no recorte */
  totalEntities: number;
  entitiesSynced: number;
  entitiesWithoutSource: number;
  entitiesWithActiveContract: number;
  activeContracts: number;
  /** alarmes de emissão a vencer (dentro da antecedência) ou atrasados */
  issuanceDue: number;
  contractsExpiring: number;
  /** renovações de contrato em aberto (Fase 3) */
  renewalsOpen: number;
  certificatesExpiring: number;
  needsReconciliation: number;
}

export interface MonthlySeriesPoint {
  competence: string; // "2026-09"
  received: string;
  pending: string;
  issued: string;
}

export interface AgingPoint {
  bucket: AgingBucket;
  count: number;
  amount: string;
}

export interface TopDebtor {
  entityId: string;
  entityName: string;
  entityType: EntityType;
  municipality: string;
  uf: string;
  debt: string;
  pendingInvoices: number;
  oldestPendingDays: number | null;
}

export interface RecentPayment {
  invoiceId: string;
  entityId: string;
  entityName: string;
  amount: string;
  paidAt: string;
  competence: string;
  number: string;
}

export interface AttentionItem {
  kind:
    | 'OLD_INVOICE'
    | 'SERVICE_ORDER_PENDING'
    | 'CERTIFICATE_EXPIRING'
    | 'CERTIFICATE_EXPIRED'
    | 'CONTRACT_EXPIRING'
    | 'COLLECTION_OVERDUE'
    | 'RECONCILIATION'
    | 'SYNC_FAILED'
    | 'MISSING_INVOICE'
    | 'ISSUANCE_DUE'
    | 'OPPORTUNITY_STALLED'
    | 'TENDER_DEADLINE';
  title: string;
  detail: string;
  entityId: string | null;
  referenceId: string | null;
  severity: 'info' | 'warning' | 'high';
  date: string | null;
}

export interface DashboardResponse {
  generatedAt: string;
  cards: DashboardCards;
  monthly: MonthlySeriesPoint[];
  aging: AgingPoint[];
  topDebtors: TopDebtor[];
  recentPayments: RecentPayment[];
  attention: AttentionItem[];
}

/** Conta corrente do contrato. */
export interface ContractLedgerMonth {
  competence: string; // "2026-09"
  expected: string; // valor esperado (valor mensal vigente)
  invoiced: string; // soma das notas emitidas
  paid: string;
  pending: string;
  invoiceCount: number;
  state: 'NOT_INVOICED' | 'PENDING' | 'PAID' | 'PARTIAL' | 'FUTURE';
}

export interface ContractLedger {
  contractId: string;
  contractNumber: string;
  status: ContractStatus;
  monthlyValue: string | null;
  startDate: string | null;
  endDate: string | null;
  totals: {
    expected: string;
    invoiced: string;
    paid: string;
    pending: string;
    monthsNotInvoiced: number;
    monthsPending: number;
    lastPaymentAt: string | null;
    lastPaymentAmount: string | null;
  };
  months: ContractLedgerMonth[];
}

export interface CertificateView {
  id: string;
  slug: string;
  name: string;
  entityId: string | null;
  status: CertificateStatus;
  daysToExpire: number | null;
  current: {
    id: string;
    validUntil: string | null;
    issuedAt: string | null;
    capturedAt: string;
    documentId: string | null;
    sourceUrl: string | null;
  } | null;
  versionsCount: number;
}

// ---------- alarmes de emissão ----------
export interface IssuanceAlarm {
  id: string;
  entityId: string;
  entityName: string;
  entityShortName: string | null;
  contractNumber: string | null;
  label: string;
  dayOfMonth: number;
  leadDays: number;
  isActive: boolean;
  notes: string | null;
}
export type IssuanceDeadlineStatus = 'LATE' | 'DUE' | 'UPCOMING' | 'ISSUED';
/** Próximo prazo calculado para um alarme (mês corrente ou seguinte). */
export interface IssuanceDeadline extends IssuanceAlarm {
  /** data-alvo (YYYY-MM-DD) do próximo prazo */
  dueDate: string;
  /** competência do prazo (YYYY-MM) */
  competence: string;
  /** dias até o prazo (negativo = atrasado) */
  daysUntil: number;
  status: IssuanceDeadlineStatus;
  /** nº da nota emitida no mês do prazo, quando houver */
  issuedInvoiceNumber: string | null;
  issuedAt: string | null;
}

// ---------- Cadastro Público ----------
export interface PublicAgent {
  id: string; entityId: string; name: string; position: string; party: string | null; termStart: string | null; termEnd: string | null;
  email: string | null; phone: string | null; whatsapp: string | null; isDecisionMaker: boolean; isActive: boolean; notes: string | null;
}
/** Evento da linha do tempo 360º (união de todos os módulos; somente leitura). */
export interface TimelineEvent {
  id: string;
  module: 'FINANCEIRO' | 'CADASTRO' | 'SINCRONIZACAO' | 'AGENDA' | 'COBRANCA' | 'DOCUMENTOS' | 'AUDITORIA' | 'COMERCIAL' | 'LICITACOES' | 'ATENDIMENTO';
  kind: string;
  title: string;
  detail: string | null;
  occurredAt: string;
  userName: string | null;
  referenceType: string | null;
  referenceId: string | null;
}
export interface HealthFactor { key: string; label: string; impact: number; detail: string }
export interface EntityHealth { score: number | null; factors: HealthFactor[]; updatedAt: string | null; band: 'SAUDAVEL' | 'ATENCAO' | 'RISCO' | 'SEM_DADOS' }

// ---------- CRM Comercial (Fase 2) ----------
export interface PipelineStageRow { id: string; pipelineId: string; name: string; position: number; probability: number; kind: 'OPEN' | 'WON' | 'LOST'; slaDays: number | null; color: string | null }
export interface PipelineRow { id: string; name: string; isDefault: boolean; isActive: boolean; stages: PipelineStageRow[] }
export interface OpportunityItemRow { id: string; catalogItemId: string | null; description: string; quantity: string; unitPrice: string; recurrence: string; total: string; position: number }
export interface OpportunityRow {
  id: string; title: string; description: string | null; status: 'OPEN' | 'WON' | 'LOST';
  entity: { id: string; name: string; shortName: string | null; type: string; municipality: string; uf: string };
  pipelineId: string; stage: PipelineStageRow;
  monthlyAmount: string | null; oneTimeAmount: string | null; termMonths: number | null; totalAmount: string | null;
  probability: number | null; effectiveProbability: number; weightedAmount: string;
  expectedCloseDate: string | null; source: string | null;
  owner: { id: string; name: string } | null; lostReason: string | null; lostNotes: string | null;
  wonAt: string | null; lostAt: string | null; contractId: string | null;
  stageEnteredAt: string; daysInStage: number; stalled: boolean; lastActivityAt: string | null;
  nextTask: { id: string; title: string; dueDate: string; status: string } | null;
  proposalCount: number; openTaskCount: number;
  createdAt: string; updatedAt: string;
}
export interface OpportunityEventRow { id: string; action: string; fromValue: string | null; toValue: string | null; notes: string | null; createdAt: string; userName: string | null }
export interface ProposalItemRow { id: string; description: string; quantity: string; unitPrice: string; recurrence: string; total: string; position: number }
export interface ProposalRow { id: string; opportunityId: string; version: number; title: string; status: string; validUntil: string | null; introduction: string | null; terms: string | null; notes: string | null; totalMonthly: string; totalOneTime: string; sentAt: string | null; createdAt: string; items: ProposalItemRow[] }
export interface CatalogItemRow { id: string; code: string | null; name: string; description: string | null; category: string | null; unitPrice: string; recurrence: string; isActive: boolean }
export interface GoalRow { id: string; userId: string | null; userName: string | null; metric: string; periodStart: string; periodEnd: string; target: string; label: string | null; achieved: string; percent: number }
export interface CrmDashboard {
  generatedAt: string;
  period: { from: string; to: string };
  cards: { open: number; openAmount: string; weightedAmount: string; wonCount: number; wonAmount: string; lostCount: number; conversionRate: number | null; stalled: number; activitiesDue: number; activitiesOverdue: number; avgCycleDays: number | null };
  funnel: Array<{ stageId: string; name: string; kind: string; count: number; amount: string; stalled: number }>;
  byOwner: Array<{ userId: string | null; name: string; open: number; won: number; wonAmount: string; lost: number }>;
  lossReasons: Array<{ reason: string; count: number }>;
  forecast: Array<{ month: string; expected: string; weighted: string; count: number }>;
  goals: GoalRow[];
  stalledList: Array<{ id: string; title: string; entityName: string; stageName: string; daysInStage: number; ownerName: string | null }>;
}

// ---------- Gestão de Contratos (Fase 3) ----------
export interface ContractFinancialStatus {
  contractId: string;
  status: ContractStatus;
  monthlyValue: string | null;
  startDate: string | null;
  endDate: string | null;
  daysToEnd: number | null;
  /** PREVISTO (calculado a partir do contrato): valor mensal vigente × meses restantes + total já esperado */
  forecast: { basis: 'CONTRATO' | 'ULTIMA_NOTA' | 'SEM_BASE'; monthly: string; remainingMonths: number; remainingAmount: string; expectedToDate: string; contractTotal: string | null };
  /** FATURADO (notas emitidas, exceto canceladas) — fonte: Financeiro */
  invoiced: { total: string; count: number; lastAt: string | null };
  /** RECEBIDO (notas pagas) — fonte: Financeiro */
  received: { total: string; count: number; lastAt: string | null; lastAmount: string | null };
  /** PENDENTE (notas emitidas e não pagas) */
  pending: { total: string; count: number; oldestDays: number | null };
  monthsNotInvoiced: number;
  byYear: Array<{ year: number; expected: string; invoiced: string; received: string; pending: string }>;
  renewal: { id: string; status: string; endDate: string; opportunityId: string | null; taskId: string | null } | null;
  adjustments: Array<{ id: string; label: string | null; indexName: string | null; percent: string | null; effectiveFrom: string | null; newMonthlyValue: string | null }>;
}
export interface ContractRenewalRow {
  id: string; contractId: string; contractNumber: string; endDate: string; status: string; daysToEnd: number;
  entity: { id: string; name: string; shortName: string | null };
  monthlyValue: string | null; opportunityId: string | null; opportunityStatus: string | null; taskId: string | null; taskStatus: string | null;
  amendmentId: string | null; newContractId: string | null; notes: string | null; decidedAt: string | null; decidedBy: string | null; createdAt: string;
}

// ---------- Parceiros e Comissões (Fase 4) ----------
export interface PartnerRow {
  id: string; name: string; kind: string; document: string | null; contactName: string | null; email: string | null; phone: string | null; whatsapp: string | null;
  userId: string | null; userName: string | null; bankInfo: string | null; notes: string | null; isActive: boolean;
  entityCount: number; contractCount: number; opportunityCount: number; ruleCount: number;
  totals: { forecast: string; due: string; paid: string; reversed: string };
}
export interface CommissionRuleRow { id: string; partnerId: string; name: string; basis: string; percent: string; entityId: string | null; entityName: string | null; contractId: string | null; contractNumber: string | null; startDate: string | null; endDate: string | null; maxMonths: number | null; isActive: boolean; notes: string | null }
export interface CommissionRow {
  id: string; partnerId: string; partnerName: string; ruleId: string; ruleName: string; invoiceId: string; invoiceNumber: string; invoiceStatus: string;
  entity: { id: string; name: string; shortName: string | null }; contractNumber: string | null; competence: string;
  baseAmount: string; percent: string; amount: string; status: string; dueAt: string | null; paidAt: string | null; paymentRef: string | null; notes: string | null;
}
export interface PartnerStatement {
  partner: PartnerRow;
  totals: { forecast: string; due: string; paid: string; reversed: string; dueCount: number };
  byMonth: Array<{ competence: string; forecast: string; due: string; paid: string }>;
  entities: Array<{ id: string; name: string; shortName: string | null; municipality: string; uf: string; activeContract: string | null }>;
  opportunities: Array<{ id: string; title: string; status: string; stageName: string; totalAmount: string | null; entityName: string }>;
}

// ---------- Licitações (Fase 5) ----------
export interface TenderDeadlineRow { id: string; kind: string; title: string; dueAt: string; done: boolean; notes: string | null; overdue: boolean; daysLeft: number }
export interface TenderCompetitorRow { id: string; name: string; document: string | null; proposalValue: string | null; rank: number | null; isWinner: boolean; notes: string | null }
export interface TenderChecklistRow { id: string; title: string; certificateId: string | null; certificateName: string | null; certificateValidUntil: string | null; certificateStatus: 'VALID' | 'EXPIRING' | 'EXPIRED' | 'MISSING' | null; documentId: string | null; required: boolean; done: boolean; position: number; notes: string | null }
export interface TenderRow {
  id: string; entity: { id: string; name: string; shortName: string | null; municipality: string; uf: string }; opportunityId: string | null;
  modality: string; number: string; year: number | null; officialId: string | null; object: string; status: string;
  estimatedValue: string | null; ourProposalValue: string | null; winnerValue: string | null;
  publishedAt: string | null; proposalDeadline: string | null; sessionAt: string | null; resultAt: string | null; homologatedAt: string | null;
  portalUrl: string | null; source: string; owner: { id: string; name: string } | null; lossReason: string | null; notes: string | null;
  nextDeadline: { title: string; dueAt: string; overdue: boolean } | null; openDeadlines: number; checklistDone: number; checklistTotal: number; checklistBlocked: number;
  contractId: string | null; createdAt: string; updatedAt: string;
}
export interface TenderDetail extends TenderRow {
  deadlines: TenderDeadlineRow[]; competitors: TenderCompetitorRow[]; checklist: TenderChecklistRow[];
  events: Array<{ id: string; action: string; fromValue: string | null; toValue: string | null; notes: string | null; createdAt: string; userName: string | null }>;
}
export interface PncpPublication {
  officialId: string; modalityCode: number; modality: string; number: string; year: number | null; object: string; estimatedValue: string | null;
  publishedAt: string | null; proposalOpensAt: string | null; proposalDeadline: string | null; orgName: string; orgDocument: string | null; unitName: string | null;
  municipality: string | null; uf: string | null; portalUrl: string | null; situation: string | null;
  match: { entityId: string | null; entityName: string | null; alreadyImportedId: string | null };
}
