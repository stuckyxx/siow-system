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
  'COMMERCIAL_FOLLOWUP',
  'VISIT',
  'MEETING',
  'CALL',
  'RENEWAL',
  'UPDATE_CONTACTS',
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
  COMMERCIAL_FOLLOWUP: 'Retorno comercial',
  VISIT: 'Visita',
  MEETING: 'Reunião',
  CALL: 'Ligação',
  RENEWAL: 'Renovação de contrato',
  UPDATE_CONTACTS: 'Atualizar contatos (troca de gestão)',
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
  'TENDER',
  'TICKET',
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
  TENDER: 'Licitação (edital, anexo, proposta)',
  TICKET: 'Anexo de chamado de atendimento',
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

/** Organização padrão (Edição Própria). Todas as linhas pré-existentes foram atribuídas a ela na migração multi-organização. */
export const DEFAULT_ORGANIZATION_ID = '7a1b5c3e-5e1f-4a4e-8c0d-000000000001';
export const DEFAULT_ORGANIZATION_SLUG = 'siow-system-tecnologia';
export const DEFAULT_ORGANIZATION_NAME = 'Siow System Tecnologia';

// ---------- CRM Comercial (Fase 2) ----------
export const OPPORTUNITY_STATUSES = ['OPEN', 'WON', 'LOST'] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];
export const OPPORTUNITY_STATUS_LABELS: Record<OpportunityStatus, string> = { OPEN: 'Em andamento', WON: 'Ganha', LOST: 'Perdida' };
export const STAGE_KINDS = ['OPEN', 'WON', 'LOST'] as const;
export type StageKind = (typeof STAGE_KINDS)[number];
export const RECURRENCES = ['MONTHLY', 'ONE_TIME', 'YEARLY'] as const;
export type Recurrence = (typeof RECURRENCES)[number];
export const RECURRENCE_LABELS: Record<Recurrence, string> = { MONTHLY: 'Mensal', ONE_TIME: 'Único', YEARLY: 'Anual' };
export const OPPORTUNITY_SOURCES = ['PROSPECCAO', 'INDICACAO', 'PARCEIRO', 'LICITACAO', 'RENOVACAO', 'INBOUND', 'OUTRO'] as const;
export type OpportunitySource = (typeof OPPORTUNITY_SOURCES)[number];
export const OPPORTUNITY_SOURCE_LABELS: Record<OpportunitySource, string> = { PROSPECCAO: 'Prospecção', INDICACAO: 'Indicação', PARCEIRO: 'Parceiro', LICITACAO: 'Licitação', RENOVACAO: 'Renovação', INBOUND: 'Contato recebido', OUTRO: 'Outro' };
export const PROPOSAL_STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'SUPERSEDED'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];
export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = { DRAFT: 'Rascunho', SENT: 'Enviada', ACCEPTED: 'Aceita', REJECTED: 'Recusada', SUPERSEDED: 'Substituída' };
export const GOAL_METRICS = ['WON_AMOUNT', 'WON_COUNT', 'ACTIVITIES'] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];
export const GOAL_METRIC_LABELS: Record<GoalMetric, string> = { WON_AMOUNT: 'Valor ganho (R$)', WON_COUNT: 'Oportunidades ganhas', ACTIVITIES: 'Atividades concluídas' };
/** Tipos de tarefa que contam como atividade comercial na agenda única. */
export const COMMERCIAL_TASK_TYPES = ['COMMERCIAL_FOLLOWUP', 'VISIT', 'MEETING', 'CALL', 'RENEWAL'] as const;

// ---------- Gestão de Contratos (Fase 3) ----------
export const AMENDMENT_KINDS = ['TERM', 'VALUE', 'OBJECT', 'MIXED', 'OTHER', 'ADJUSTMENT', 'EXTENSION'] as const;
export type AmendmentKind = (typeof AMENDMENT_KINDS)[number];
export const AMENDMENT_KIND_LABELS: Record<AmendmentKind, string> = { TERM: 'Prazo', VALUE: 'Valor', MIXED: 'Prazo e valor', OBJECT: 'Objeto', OTHER: 'Outro', ADJUSTMENT: 'Reajuste', EXTENSION: 'Prorrogação' };
export const RENEWAL_STATUSES = ['OPEN', 'RENEWED', 'NOT_RENEWED', 'CANCELLED'] as const;
export type RenewalStatus = (typeof RENEWAL_STATUSES)[number];
export const RENEWAL_STATUS_LABELS: Record<RenewalStatus, string> = { OPEN: 'Em aberto', RENEWED: 'Renovado', NOT_RENEWED: 'Não renovado', CANCELLED: 'Cancelada' };
export const ADJUSTMENT_INDEXES = ['IPCA', 'INPC', 'IGP-M', 'IGP-DI', 'INCC', 'Negociado', 'Outro'] as const;

// ---------- Parceiros e Comissões (Fase 4) ----------
export const PARTNER_KINDS = ['REPRESENTANTE', 'INDICADOR', 'EMPRESA'] as const;
export type PartnerKind = (typeof PARTNER_KINDS)[number];
export const PARTNER_KIND_LABELS: Record<PartnerKind, string> = { REPRESENTANTE: 'Representante', INDICADOR: 'Indicador', EMPRESA: 'Empresa parceira' };
export const COMMISSION_BASES = ['RECEIVED', 'INVOICED'] as const;
export type CommissionBasis = (typeof COMMISSION_BASES)[number];
export const COMMISSION_BASIS_LABELS: Record<CommissionBasis, string> = { RECEIVED: 'Sobre o recebimento (nota paga)', INVOICED: 'Sobre o faturamento (nota emitida)' };
export const COMMISSION_STATUSES = ['FORECAST', 'DUE', 'PAID', 'REVERSED'] as const;
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];
export const COMMISSION_STATUS_LABELS: Record<CommissionStatus, string> = { FORECAST: 'Prevista', DUE: 'A pagar', PAID: 'Paga', REVERSED: 'Estornada' };

// ---------- Licitações (Fase 5) ----------
export const TENDER_MODALITIES = ['PREGAO_ELETRONICO', 'PREGAO_PRESENCIAL', 'CONCORRENCIA', 'DISPENSA', 'INEXIGIBILIDADE', 'CREDENCIAMENTO', 'REGISTRO_PRECOS', 'ADESAO_ATA', 'LEILAO', 'CONCURSO', 'DIALOGO_COMPETITIVO', 'OUTRA'] as const;
export type TenderModality = (typeof TENDER_MODALITIES)[number];
export const TENDER_MODALITY_LABELS: Record<TenderModality, string> = { PREGAO_ELETRONICO: 'Pregão eletrônico', PREGAO_PRESENCIAL: 'Pregão presencial', CONCORRENCIA: 'Concorrência', DISPENSA: 'Dispensa', INEXIGIBILIDADE: 'Inexigibilidade', CREDENCIAMENTO: 'Credenciamento', REGISTRO_PRECOS: 'Registro de preços', ADESAO_ATA: 'Adesão a ata', LEILAO: 'Leilão', CONCURSO: 'Concurso', DIALOGO_COMPETITIVO: 'Diálogo competitivo', OUTRA: 'Outra' };
export const TENDER_STATUSES = ['IDENTIFIED', 'ANALYZING', 'PREPARING', 'SUBMITTED', 'IN_SESSION', 'WON', 'LOST', 'HOMOLOGATED', 'CANCELLED', 'DESERTED', 'NOT_PARTICIPATING'] as const;
export type TenderStatus = (typeof TENDER_STATUSES)[number];
export const TENDER_STATUS_LABELS: Record<TenderStatus, string> = { IDENTIFIED: 'Identificada', ANALYZING: 'Em análise', PREPARING: 'Preparando proposta', SUBMITTED: 'Proposta enviada', IN_SESSION: 'Em sessão', WON: 'Vencida', LOST: 'Perdida', HOMOLOGATED: 'Homologada', CANCELLED: 'Cancelada/revogada', DESERTED: 'Deserta', NOT_PARTICIPATING: 'Não participamos' };
export const TENDER_OPEN_STATUSES: TenderStatus[] = ['IDENTIFIED', 'ANALYZING', 'PREPARING', 'SUBMITTED', 'IN_SESSION', 'WON'];
export const TENDER_DEADLINE_KINDS = ['PUBLICATION', 'QUESTIONS', 'IMPUGNATION', 'PROPOSAL', 'SESSION', 'APPEAL', 'RESULT', 'HOMOLOGATION', 'SIGNATURE', 'OTHER'] as const;
export type TenderDeadlineKind = (typeof TENDER_DEADLINE_KINDS)[number];
export const TENDER_DEADLINE_KIND_LABELS: Record<TenderDeadlineKind, string> = { PUBLICATION: 'Publicação', QUESTIONS: 'Esclarecimentos', IMPUGNATION: 'Impugnação', PROPOSAL: 'Envio da proposta', SESSION: 'Sessão pública', APPEAL: 'Recurso', RESULT: 'Resultado', HOMOLOGATION: 'Homologação', SIGNATURE: 'Assinatura do contrato', OTHER: 'Outro' };
/** Modalidades do PNCP (codigoModalidadeContratacao) → modalidade interna. */
export const PNCP_MODALITIES: Record<number, TenderModality> = { 1: 'LEILAO', 2: 'DIALOGO_COMPETITIVO', 3: 'CONCURSO', 4: 'CONCORRENCIA', 5: 'CONCORRENCIA', 6: 'PREGAO_ELETRONICO', 7: 'PREGAO_PRESENCIAL', 8: 'DISPENSA', 9: 'INEXIGIBILIDADE', 10: 'OUTRA', 11: 'OUTRA', 12: 'CREDENCIAMENTO', 13: 'LEILAO' };

// ---------------- Fase 6: Atendimento ----------------
export const TICKET_TYPES = ['SUPPORT', 'COMMERCIAL', 'FINANCIAL', 'REQUEST', 'COMPLAINT', 'VISIT', 'MEETING', 'OTHER'] as const;
export type TicketType = (typeof TICKET_TYPES)[number];
export const TICKET_TYPE_LABELS: Record<TicketType, string> = { SUPPORT: 'Suporte técnico', COMMERCIAL: 'Solicitação comercial', FINANCIAL: 'Solicitação financeira', REQUEST: 'Solicitação', COMPLAINT: 'Reclamação', VISIT: 'Visita', MEETING: 'Reunião', OTHER: 'Outro' };
export const TICKET_CHANNELS = ['WHATSAPP', 'EMAIL', 'PHONE', 'IN_PERSON', 'PORTAL', 'OTHER'] as const;
export type TicketChannel = (typeof TICKET_CHANNELS)[number];
export const TICKET_CHANNEL_LABELS: Record<TicketChannel, string> = { WHATSAPP: 'WhatsApp', EMAIL: 'E-mail', PHONE: 'Telefone', IN_PERSON: 'Presencial', PORTAL: 'Portal/sistema', OTHER: 'Outro' };
export const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_CLIENT', 'WAITING_INTERNAL', 'RESOLVED', 'CLOSED', 'CANCELLED'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = { OPEN: 'Aberto', IN_PROGRESS: 'Em atendimento', WAITING_CLIENT: 'Aguardando cliente', WAITING_INTERNAL: 'Aguardando interno', RESOLVED: 'Resolvido', CLOSED: 'Encerrado', CANCELLED: 'Cancelado' };
export const TICKET_OPEN_STATUSES: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING_CLIENT', 'WAITING_INTERNAL'];
export const INTERACTION_KINDS = ['NOTE', 'REPLY', 'CALL', 'EMAIL', 'WHATSAPP', 'VISIT', 'MEETING', 'STATUS', 'ASSIGNMENT', 'SYSTEM'] as const;
export type InteractionKind = (typeof INTERACTION_KINDS)[number];
export const INTERACTION_KIND_LABELS: Record<InteractionKind, string> = { NOTE: 'Nota interna', REPLY: 'Resposta ao cliente', CALL: 'Ligação', EMAIL: 'E-mail', WHATSAPP: 'WhatsApp', VISIT: 'Visita', MEETING: 'Reunião (ata)', STATUS: 'Situação', ASSIGNMENT: 'Responsável', SYSTEM: 'Sistema' };
export const INTERACTION_DIRECTIONS = ['INBOUND', 'OUTBOUND', 'INTERNAL'] as const;
export type InteractionDirection = (typeof INTERACTION_DIRECTIONS)[number];
export const INTERACTION_DIRECTION_LABELS: Record<InteractionDirection, string> = { INBOUND: 'Recebida do cliente', OUTBOUND: 'Enviada ao cliente', INTERNAL: 'Interna' };
export const CAMPAIGN_STATUSES = ['DRAFT', 'RUNNING', 'DONE', 'CANCELLED'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = { DRAFT: 'Rascunho', RUNNING: 'Em envio', DONE: 'Concluída', CANCELLED: 'Cancelada' };
