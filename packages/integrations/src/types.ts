/**
 * Contratos da camada de integração (BillingProvider).
 *
 * O restante do sistema só conhece estes tipos normalizados — nunca o HTML,
 * os textos ou a estrutura do portal externo. Trocar/adicionar um provider
 * (API oficial, outro portal, Playwright) não exige mudanças fora deste pacote.
 */

export type ProviderKey = 'ASSESI_PORTAL' | 'ASSESI_API' | 'MANUAL';

export type NormalizedInvoiceStatus = 'PENDING' | 'PAID' | 'CANCELLED' | 'UNKNOWN';

export interface EntitySnapshot {
  name: string | null; // Ex.: "CÂMARA MUNICIPAL DE BOM LUGAR"
  shortName: string | null; // Ex.: "CM BOM LUGAR"
  uf: string | null;
  externalCode: string | null; // codEntidade
  externalType: string | null; // tipoEntidade
  logoUrl: string | null;
}

export interface ContractSnapshot {
  externalCode: string | null; // NContrato
  number: string | null; // "070201001/2025"
  amendmentLabel: string | null; // "1º Ad", "6º ADT"
  amendmentSequence: number | null; // 1, 6
  startDate: string | null; // ISO civil
  endDate: string | null;
  rawHeader: string; // texto original para diagnóstico
}

export interface DocumentRef {
  kind: 'INVOICE' | 'RECEIPT' | 'CERTIFICATE' | 'SERVICE_REPORT' | 'PAYMENT_REQUEST' | 'LABOR_DECLARATION';
  url: string;
  method: 'GET' | 'POST';
  /** corpo do formulário quando POST */
  form?: Record<string, string>;
  /** Acesso incrementa contador/registro no portal externo — só baixar sob demanda. */
  sideEffects?: boolean;
}

export interface InvoiceSnapshot {
  number: string;
  externalId: string | null;
  contractExternalCode: string | null;
  competenceMonth: number;
  competenceYear: number;
  amount: number; // em reais
  issueDate: string | null;
  status: NormalizedInvoiceStatus;
  statusRaw: string;
  paidAt: string | null;
  description: string | null;
  documents: DocumentRef[];
  raw: Record<string, unknown>;
}

export interface CertificateSnapshot {
  name: string;
  externalId: string | null;
  url: string;
  validUntil: string | null;
  issuedAt: string | null;
}

export interface SummarySnapshot {
  totalDebt: number | null;
  pendingCount: number | null;
  paidCount: number | null;
  totalPaid: number | null;
  lastPaymentAt: string | null;
  statusText: string | null; // ex.: "Em Dia"
}

export interface BillingSnapshot {
  provider: ProviderKey;
  sourceUrl: string;
  fetchedAt: string; // ISO datetime
  entity: EntitySnapshot;
  contracts: ContractSnapshot[];
  invoices: InvoiceSnapshot[];
  certificates: CertificateSnapshot[];
  certificatesUpdatedAt: string | null;
  summary: SummarySnapshot;
  /** true quando a listagem COMPLETA (pendentes + pagas) foi obtida. */
  invoiceListComplete: boolean;
  warnings: string[];
}

export interface FetchedFile {
  buffer: Buffer;
  mimeType: string;
  fileName: string | null;
  size: number;
}

export interface ProviderContext {
  timeoutMs: number;
  userAgent: string;
  logger?: { info: (m: string, meta?: unknown) => void; warn: (m: string, meta?: unknown) => void };
  /** Injetável para testes. */
  fetchImpl?: typeof fetch;
}

export interface BillingProvider {
  readonly key: ProviderKey;
  /** Coleta o estado atual da fonte (entidade, contratos, notas, certidões, resumo). */
  fetchSnapshot(input: { url: string; config?: Record<string, unknown> | null }, ctx: ProviderContext): Promise<BillingSnapshot>;
  /** Baixa um documento referenciado no snapshot. */
  fetchDocument(ref: DocumentRef, ctx: ProviderContext): Promise<FetchedFile>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly statusCode?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ProviderError';
  }
}
