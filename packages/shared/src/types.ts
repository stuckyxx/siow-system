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
    | 'ISSUANCE_DUE';
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
