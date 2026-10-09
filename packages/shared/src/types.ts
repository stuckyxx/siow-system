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
}

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
  activeContracts: number;
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
    | 'MISSING_INVOICE';
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
