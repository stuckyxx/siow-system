/**
 * Enumerações compartilhadas (espelham o schema Prisma) com rótulos em PT-BR.
 * O frontend nunca depende do texto do portal externo — apenas destes valores normalizados.
 */

export const ENTITY_TYPES = ['PM', 'CM', 'AUTARQUIA', 'FUNDO', 'INSTITUTO', 'CONSORCIO', 'OUTRO'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];
export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  PM: 'Prefeitura Municipal',
  CM: 'Câmara Municipal',
  AUTARQUIA: 'Autarquia',
  FUNDO: 'Fundo',
  INSTITUTO: 'Instituto',
  CONSORCIO: 'Consórcio',
  OUTRO: 'Outro',
};

export const INVOICE_STATUSES = ['PENDING', 'PAID', 'CANCELLED', 'UNKNOWN'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  PENDING: 'Pendente',
  PAID: 'Paga',
  CANCELLED: 'Cancelada',
  UNKNOWN: 'Indefinido',
};

export const CONTRACT_STATUSES = ['DRAFT', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'TERMINATED'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];
export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  DRAFT: 'Rascunho',
  ACTIVE: 'Ativo',
  SUSPENDED: 'Suspenso',
  EXPIRED: 'Encerrado (vigência)',
  TERMINATED: 'Rescindido',
};

export const TASK_STATUSES = ['PENDING', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  PENDING: 'Pendente',
  IN_PROGRESS: 'Em andamento',
  DONE: 'Concluída',
  CANCELLED: 'Cancelada',
};

export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: 'Baixa',
  MEDIUM: 'Média',
  HIGH: 'Alta',
  URGENT: 'Urgente',
};

export const TASK_TYPES = [
  'CHARGE_CLIENT',
  'CHARGE_AGAIN',
  'VERIFY_PAYMENT',
  'REQUEST_SERVICE_ORDER',
  'VERIFY_SIGNATURE',
  'RENEW_CERTIFICATE',
  'VERIFY_CONTRACT',
  'SEND_DOCUMENT',
  'CONFIRM_PAYMENT',
  'CUSTOM',
] as const;
export type TaskType = (typeof TASK_TYPES)[number];
export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  CHARGE_CLIENT: 'Cobrar município',
  CHARGE_AGAIN: 'Cobrar novamente',
  VERIFY_PAYMENT: 'Verificar pagamento',
  REQUEST_SERVICE_ORDER: 'Solicitar ordem de serviço',
  VERIFY_SIGNATURE: 'Verificar assinatura',
  RENEW_CERTIFICATE: 'Renovar certidão',
  VERIFY_CONTRACT: 'Verificar contrato',
  SEND_DOCUMENT: 'Enviar documento',
  CONFIRM_PAYMENT: 'Confirmar pagamento',
  CUSTOM: 'Tarefa personalizada',
};

export const COLLECTION_STATUSES = [
  'NOT_CHARGED',
  'SCHEDULED',
  'SENT',
  'CLIENT_REPLIED',
  'PAYMENT_PROMISED',
  'AWAITING_PAYMENT',
  'SETTLED',
] as const;
export type CollectionStatus = (typeof COLLECTION_STATUSES)[number];
export const COLLECTION_STATUS_LABELS: Record<CollectionStatus, string> = {
  NOT_CHARGED: 'Não cobrada',
  SCHEDULED: 'Cobrança programada',
  SENT: 'Cobrança enviada',
  CLIENT_REPLIED: 'Cliente respondeu',
  PAYMENT_PROMISED: 'Promessa de pagamento',
  AWAITING_PAYMENT: 'Aguardando pagamento',
  SETTLED: 'Quitada',
};

export const MESSAGE_CHANNELS = ['WHATSAPP', 'EMAIL', 'PHONE', 'IN_PERSON', 'OTHER'] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];
export const MESSAGE_CHANNEL_LABELS: Record<MessageChannel, string> = {
  WHATSAPP: 'WhatsApp',
  EMAIL: 'E-mail',
  PHONE: 'Telefone',
  IN_PERSON: 'Presencial',
  OTHER: 'Outro',
};

export const SERVICE_ORDER_STATUSES = [
  'NOT_REQUESTED',
  'REQUESTED',
  'AWAITING_ISSUE',
  'ISSUED',
  'AWAITING_SIGNATURE',
  'SIGNED',
  'CANCELLED',
] as const;
export type ServiceOrderStatus = (typeof SERVICE_ORDER_STATUSES)[number];
export const SERVICE_ORDER_STATUS_LABELS: Record<ServiceOrderStatus, string> = {
  NOT_REQUESTED: 'Não solicitada',
  REQUESTED: 'Solicitada',
  AWAITING_ISSUE: 'Aguardando emissão',
  ISSUED: 'Emitida',
  AWAITING_SIGNATURE: 'Aguardando assinatura',
  SIGNED: 'Assinada',
  CANCELLED: 'Cancelada',
};

export const DOCUMENT_TYPES = [
  'INVOICE',
  'SERVICE_REPORT',
  'PAYMENT_REQUEST',
  'LABOR_DECLARATION',
  'RECEIPT',
  'AMENDMENT_REQUEST',
  'CERTIFICATE',
  'CONTRACT',
  'SERVICE_ORDER',
  'SERVICE_ORDER_SIGNED',
  'OTHER',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  INVOICE: 'Nota Fiscal',
  SERVICE_REPORT: 'Relatório de Serviços',
  PAYMENT_REQUEST: 'Solicitação de Pagamento',
  LABOR_DECLARATION: 'Declaração Trabalhista',
  RECEIPT: 'Recibo',
  AMENDMENT_REQUEST: 'Solicitação de Aditivo',
  CERTIFICATE: 'Certidão',
  CONTRACT: 'Contrato',
  SERVICE_ORDER: 'Ordem de Serviço',
  SERVICE_ORDER_SIGNED: 'Ordem de Serviço assinada',
  OTHER: 'Outro',
};

export const CERTIFICATE_STATUSES = ['VALID', 'EXPIRING', 'EXPIRED', 'UNKNOWN'] as const;
export type CertificateStatus = (typeof CERTIFICATE_STATUSES)[number];
export const CERTIFICATE_STATUS_LABELS: Record<CertificateStatus, string> = {
  VALID: 'Válida',
  EXPIRING: 'Vencendo',
  EXPIRED: 'Vencida',
  UNKNOWN: 'Sem validade informada',
};

export const SYNC_STATUSES = ['QUEUED', 'RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED', 'SKIPPED'] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];
export const SYNC_STATUS_LABELS: Record<SyncStatus, string> = {
  QUEUED: 'Na fila',
  RUNNING: 'Executando',
  SUCCESS: 'Sucesso',
  PARTIAL: 'Parcial (com avisos)',
  FAILED: 'Falhou',
  SKIPPED: 'Ignorada',
};

export const AGING_BUCKETS = ['0-30', '31-60', '61-90', '90+'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];
export const AGING_BUCKET_LABELS: Record<AgingBucket, string> = {
  '0-30': '0–30 dias',
  '31-60': '31–60 dias',
  '61-90': '61–90 dias',
  '90+': 'mais de 90 dias',
};

export function agingBucket(days: number): AgingBucket {
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

// ---------- fontes de dados (portais) ----------
export const DATA_SOURCE_PROVIDERS = ['ASSESI_PORTAL', 'ADOIS_PORTAL', 'ASSESI_API', 'MANUAL'] as const;
export type DataSourceProviderKey = (typeof DATA_SOURCE_PROVIDERS)[number];
export const DATA_SOURCE_PROVIDER_LABELS: Record<DataSourceProviderKey, string> = {
  ASSESI_PORTAL: 'Portal do Cliente (Assesi)',
  ADOIS_PORTAL: 'Portal do Cliente (Adois)',
  ASSESI_API: 'API Assesi',
  MANUAL: 'Manual',
};
/** Hosts aceitos para URLs de fonte (anti-SSRF, spec §7) e o provider correspondente. */
export const PORTAL_HOSTS: Record<string, 'ASSESI_PORTAL' | 'ADOIS_PORTAL'> = {
  'assesi.com.br': 'ASSESI_PORTAL',
  'www.assesi.com.br': 'ASSESI_PORTAL',
  'adoissolucoes.com': 'ADOIS_PORTAL',
  'www.adoissolucoes.com': 'ADOIS_PORTAL',
};
/** Provider inferido pela URL (https obrigatório) ou null quando o host não é um portal conhecido. */
export function providerForUrl(url: string): 'ASSESI_PORTAL' | 'ADOIS_PORTAL' | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    return PORTAL_HOSTS[u.hostname.toLowerCase()] ?? null;
  } catch {
    return null;
  }
}
/** Link de parceiro da Adois: lista notas de várias entidades (t=2). */
export const isAdoisPartnerUrl = (url: string): boolean => {
  try {
    const u = new URL(url);
    return providerForUrl(url) === 'ADOIS_PORTAL' && u.searchParams.get('t') === '2';
  } catch {
    return false;
  }
};
