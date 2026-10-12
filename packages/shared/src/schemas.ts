import { z } from 'zod';
import {
  COLLECTION_STATUSES,
  CONTRACT_STATUSES,
  DATA_SOURCE_PROVIDERS,
  DOCUMENT_TYPES,
  ENTITY_TYPES,
  isAdoisPartnerUrl,
  providerForUrl,
  INVOICE_STATUSES,
  MESSAGE_CHANNELS,
  SERVICE_ORDER_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
} from './enums.js';

// ---------- primitivos ----------
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD');
export const decimalString = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? v.toFixed(2) : v))
  .pipe(z.string().regex(/^-?\d+(\.\d{1,2})?$/, 'Valor decimal inválido'));
export const uuid = z.string().uuid();
export const uf = z.string().length(2).transform((s) => s.toUpperCase());
/**
 * Booleano vindo de query string. `z.coerce.boolean()` trataria "false" como
 * true (string não vazia); aqui só aceitamos true/false/1/0.
 */
export const boolParam = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')
  .optional();

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sortBy: z.string().max(60).optional(),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});
export type Pagination = z.infer<typeof paginationSchema>;

// ---------- auth ----------
export const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
});
export type LoginDto = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(8).max(200),
  newPassword: z
    .string()
    .min(10, 'Mínimo de 10 caracteres')
    .max(200)
    .regex(/[A-Z]/, 'Inclua ao menos uma letra maiúscula')
    .regex(/[0-9]/, 'Inclua ao menos um número'),
});

// ---------- usuários ----------
export const createUserSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().max(200),
  password: z.string().min(10).max(200),
  roleIds: z.array(uuid).min(1),
});
export const updateUserSchema = createUserSchema.partial().extend({ isActive: z.boolean().optional() });

// ---------- entidades ----------
export const createEntitySchema = z.object({
  type: z.enum(ENTITY_TYPES),
  name: z.string().min(2).max(200),
  shortName: z.string().max(80).optional().nullable(),
  municipality: z.string().min(2).max(120),
  uf,
  cnpj: z.string().max(20).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  responsibleUserId: uuid.optional().nullable(),
  isActive: z.boolean().optional(),
  ibgeCode: z.string().regex(/^\d{7}$/, 'Código IBGE tem 7 dígitos').optional().nullable(),
  segment: z.string().max(40).optional().nullable(),
  partnerId: uuid.optional().nullable(),
});
export const updateEntitySchema = createEntitySchema.partial();

const portalUrl = z
  .string()
  .url()
  .max(500)
  .refine((v) => providerForUrl(v) !== null, { message: 'URL deve ser https e de um portal conhecido (assesi.com.br ou adoissolucoes.com)' });

export const createDataSourceSchema = z.object({
  /** Omitido = inferido pelo host da URL (Assesi ou Adois). */
  provider: z.enum(DATA_SOURCE_PROVIDERS).optional(),
  url: portalUrl,
  label: z.string().max(120).optional().nullable(),
  syncEnabled: z.boolean().optional(),
  config: z.record(z.unknown()).optional().nullable(),
});
/** Importação de um link de parceiro da Adois (t=2): cadastra uma entidade por município encontrado. */
export const importPartnerSchema = z.object({
  url: portalUrl.refine((v) => isAdoisPartnerUrl(v), { message: 'Informe um link de parceiro da Adois (adoissolucoes.com/adm_faturas/index.php?e=…&t=2)' }),
});
/** Importação por link web (Assesi, Adois entidade ou Adois parceiro): cadastra a(s) entidade(s) do link. */
export const importLinkSchema = z.object({ url: portalUrl });
export const updateDataSourceSchema = createDataSourceSchema.partial().extend({
  isActive: z.boolean().optional(),
});

/** Linha da importação em lote (CSV/XLSX). */
export const importEntityRowSchema = z.object({
  tipo: z.enum(ENTITY_TYPES),
  entidade: z.string().min(2),
  municipio: z.string().min(2).optional(),
  uf,
  url: z.string().url(),
  nome_completo: z.string().optional(),
});
export type ImportEntityRow = z.infer<typeof importEntityRowSchema>;

export const entityListFilterSchema = paginationSchema.extend({
  q: z.string().max(200).optional(),
  type: z.enum(ENTITY_TYPES).optional(),
  uf: z.string().length(2).optional(),
  municipality: z.string().optional(),
  onlyWithDebt: boolParam,
  responsibleUserId: uuid.optional(),
  isActive: boolParam,
});

// ---------- contatos ----------
export const createContactSchema = z.object({
  name: z.string().min(2).max(120),
  role: z.string().max(120).optional().nullable(),
  department: z.string().max(120).optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  whatsapp: z.string().max(30).optional().nullable(),
  email: z.string().email().max(200).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  isPrimary: z.boolean().optional(),
  isFinancial: z.boolean().optional(),
});
export const updateContactSchema = createContactSchema.partial().extend({ isActive: z.boolean().optional() });

// ---------- contratos ----------
export const createContractSchema = z.object({
  entityId: uuid,
  number: z.string().min(1).max(60),
  object: z.string().max(2000).optional().nullable(),
  description: z.string().max(4000).optional().nullable(),
  monthlyValue: decimalString.optional().nullable(),
  totalValue: decimalString.optional().nullable(),
  startDate: isoDate.optional().nullable(),
  endDate: isoDate.optional().nullable(),
  status: z.enum(CONTRACT_STATUSES).optional(),
  expectsMonthlyBilling: z.boolean().optional(),
  responsibleUserId: uuid.optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
});
export const updateContractSchema = createContractSchema.omit({ entityId: true }).partial();

export const createAmendmentSchema = z.object({
  sequence: z.number().int().min(1).optional(),
  label: z.string().max(40).optional().nullable(),
  kind: z.enum(['TERM', 'VALUE', 'OBJECT', 'MIXED', 'OTHER', 'ADJUSTMENT', 'EXTENSION']).default('OTHER'),
  adjustmentIndex: z.string().max(40).optional().nullable(),
  adjustmentPercent: z.coerce.number().min(-100).max(1000).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  signedAt: isoDate.optional().nullable(),
  effectiveFrom: isoDate.optional().nullable(),
  newEndDate: isoDate.optional().nullable(),
  newMonthlyValue: decimalString.optional().nullable(),
  newObject: z.string().max(2000).optional().nullable(),
  documentId: uuid.optional().nullable(),
});

// ---------- notas ----------
export const invoiceListFilterSchema = paginationSchema.extend({
  q: z.string().max(100).optional(),
  entityId: uuid.optional(),
  contractId: uuid.optional(),
  entityType: z.enum(ENTITY_TYPES).optional(),
  uf: z.string().length(2).optional(),
  municipality: z.string().optional(),
  status: z.enum([...INVOICE_STATUSES, 'ALL']).optional(),
  year: z.coerce.number().int().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  competenceFrom: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  competenceTo: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  issueFrom: isoDate.optional(),
  issueTo: isoDate.optional(),
  paidFrom: isoDate.optional(),
  paidTo: isoDate.optional(),
  needsReconciliation: boolParam,
  responsibleUserId: uuid.optional(),
});
export type InvoiceListFilter = z.infer<typeof invoiceListFilterSchema>;

/** Alteração manual protegida: exige justificativa. */
export const invoiceOverrideSchema = z.object({
  status: z.enum(INVOICE_STATUSES).optional(),
  paidAt: isoDate.optional().nullable(),
  paidAmount: decimalString.optional().nullable(),
  amount: decimalString.optional(),
  contractId: uuid.optional().nullable(),
  description: z.string().max(4000).optional().nullable(),
  justification: z.string().min(10, 'Justificativa deve ter ao menos 10 caracteres').max(2000),
});
export type InvoiceOverrideDto = z.infer<typeof invoiceOverrideSchema>;

export const createManualInvoiceSchema = z.object({
  entityId: uuid,
  contractId: uuid.optional().nullable(),
  number: z.string().min(1).max(40),
  competenceMonth: z.number().int().min(1).max(12),
  competenceYear: z.number().int().min(2000).max(2100),
  amount: decimalString,
  issueDate: isoDate.optional().nullable(),
  status: z.enum(INVOICE_STATUSES).default('PENDING'),
  paidAt: isoDate.optional().nullable(),
  description: z.string().max(4000).optional().nullable(),
  justification: z.string().min(10).max(2000),
});

/** Alteração de situação em lote (ou de uma nota): sempre manual e com justificativa. */
export const bulkInvoiceStatusSchema = z.object({
  ids: z.array(uuid).min(1).max(200),
  status: z.enum(['PAID', 'PENDING']),
  paidAt: isoDate.optional().nullable(),
  justification: z.string().min(10, 'Justificativa deve ter ao menos 10 caracteres').max(2000),
});
export type BulkInvoiceStatusDto = z.infer<typeof bulkInvoiceStatusSchema>;

export const resolveConflictSchema = z.object({
  resolution: z.enum(['KEPT_MANUAL', 'ACCEPTED_SOURCE']),
  note: z.string().max(2000).optional(),
});

export const reconcileInvoiceSchema = z.object({
  status: z.enum(INVOICE_STATUSES),
  paidAt: isoDate.optional().nullable(),
  note: z.string().min(5).max(2000),
});

// ---------- dashboard ----------
export const dashboardFilterSchema = z.object({
  entityId: uuid.optional(),
  entityType: z.enum(ENTITY_TYPES).optional(),
  municipality: z.string().optional(),
  uf: z.string().length(2).optional(),
  contractId: uuid.optional(),
  year: z.coerce.number().int().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  competenceFrom: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  competenceTo: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  status: z.enum([...INVOICE_STATUSES, 'ALL']).optional(),
  responsibleUserId: uuid.optional(),
});
export type DashboardFilter = z.infer<typeof dashboardFilterSchema>;

// ---------- tarefas ----------
export const createTaskSchema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().max(4000).optional().nullable(),
  type: z.enum(TASK_TYPES).default('CUSTOM'),
  entityId: uuid.optional().nullable(),
  contractId: uuid.optional().nullable(),
  invoiceId: uuid.optional().nullable(),
  serviceOrderId: uuid.optional().nullable(),
  opportunityId: uuid.optional().nullable(),
  module: z.enum(['FINANCEIRO', 'COMERCIAL', 'LICITACOES', 'CONTRATOS', 'ATENDIMENTO']).optional(),
  assigneeUserId: uuid.optional().nullable(),
  priority: z.enum(TASK_PRIORITIES).default('MEDIUM'),
  dueDate: isoDate,
  dueTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
});
export const updateTaskSchema = createTaskSchema.partial().extend({
  status: z.enum(TASK_STATUSES).optional(),
});
export const taskListFilterSchema = paginationSchema.extend({
  assigneeUserId: z.union([uuid, z.literal('unassigned')]).optional(),
  entityId: uuid.optional(),
  status: z.enum(TASK_STATUSES).optional(),
  type: z.enum(TASK_TYPES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueFrom: isoDate.optional(),
  dueTo: isoDate.optional(),
  overdue: boolParam,
  module: z.enum(['FINANCEIRO', 'COMERCIAL', 'LICITACOES', 'CONTRATOS', 'ATENDIMENTO']).optional(),
  opportunityId: uuid.optional(),
});

// ---------- cobranças ----------
export const registerCollectionAttemptSchema = z.object({
  channel: z.enum(MESSAGE_CHANNELS),
  contactId: uuid.optional().nullable(),
  message: z.string().max(4000).optional().nullable(),
  response: z.string().max(4000).optional().nullable(),
  resultingStatus: z.enum(COLLECTION_STATUSES),
  nextActionAt: isoDate.optional().nullable(),
  nextActionNote: z.string().max(1000).optional().nullable(),
  promisedPaymentDate: isoDate.optional().nullable(),
  performedAt: z.string().datetime().optional(),
});

// ---------- mensagens ----------
export const prepareMessageSchema = z.object({
  templateKey: z.string().min(1),
  channel: z.enum(['WHATSAPP', 'EMAIL']),
  entityId: uuid,
  contactId: uuid,
  invoiceId: uuid.optional().nullable(),
  serviceOrderId: uuid.optional().nullable(),
  extraVars: z.record(z.string()).optional(),
});
export const sendMessageSchema = z.object({
  channel: z.enum(['WHATSAPP', 'EMAIL']),
  entityId: uuid,
  contactId: uuid,
  templateKey: z.string().optional(),
  invoiceId: uuid.optional().nullable(),
  serviceOrderId: uuid.optional().nullable(),
  subject: z.string().max(200).optional().nullable(),
  body: z.string().min(1).max(8000),
});
export const upsertTemplateSchema = z.object({
  key: z.string().regex(/^[A-Z0-9_]+$/).max(60),
  name: z.string().min(2).max(120),
  channel: z.enum(MESSAGE_CHANNELS).optional().nullable(),
  subject: z.string().max(200).optional().nullable(),
  body: z.string().min(1).max(8000),
  isActive: z.boolean().optional(),
});

// ---------- ordens de serviço ----------
export const createServiceOrderSchema = z.object({
  entityId: uuid,
  contractId: uuid,
  invoiceId: uuid.optional().nullable(),
  competenceMonth: z.number().int().min(1).max(12),
  competenceYear: z.number().int().min(2000).max(2100),
  number: z.string().max(60).optional().nullable(),
  status: z.enum(SERVICE_ORDER_STATUSES).optional(),
  requestedAt: isoDate.optional().nullable(),
  issuedAt: isoDate.optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
});
export const updateServiceOrderSchema = createServiceOrderSchema
  .omit({ entityId: true, contractId: true })
  .partial()
  .extend({ note: z.string().max(2000).optional() });

export const registerManualSignatureSchema = z.object({
  signedDocumentId: uuid,
  signedAt: isoDate,
  signatories: z
    .array(z.object({ name: z.string().min(2), role: z.string().optional(), email: z.string().email().optional() }))
    .min(1),
  note: z.string().max(2000).optional(),
});

// ---------- documentos ----------
export const documentUploadMetaSchema = z.object({
  type: z.enum(DOCUMENT_TYPES),
  entityId: uuid.optional(),
  contractId: uuid.optional(),
  invoiceId: uuid.optional(),
  serviceOrderId: uuid.optional(),
  sourceDate: isoDate.optional(),
  name: z.string().max(200).optional(),
});

// ---------- certidões ----------
export const registerCertificateVersionSchema = z.object({
  documentId: uuid,
  issuedAt: isoDate.optional().nullable(),
  validUntil: isoDate.optional().nullable(),
});

// ---------- relatórios ----------
export const REPORT_KEYS = [
  'financial_overview',
  'invoices',
  'receivables_by_entity',
  'defaulters',
  'payments',
  'average_days_to_pay',
  'contracts',
  'contracts_expiring',
  'certificates',
  'service_orders',
  'tasks',
  'collections',
  'invoice_history',
  'forecast',
] as const;
export const reportRequestSchema = dashboardFilterSchema.extend({
  report: z.enum(REPORT_KEYS),
  format: z.enum(['json', 'csv', 'xlsx', 'pdf']).default('json'),
});
export type ReportRequest = z.infer<typeof reportRequestSchema>;

// ---------- sync ----------
export const syncRunListFilterSchema = paginationSchema.extend({
  entityId: uuid.optional(),
  status: z.enum(['QUEUED', 'RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED', 'SKIPPED']).optional(),
});

// ---------- alarmes de emissão ----------
export const createIssuanceAlarmSchema = z.object({
  entityId: uuid,
  contractNumber: z.string().max(60).optional().nullable(),
  label: z.string().min(2).max(120).default('Emissão da nota'),
  dayOfMonth: z.number().int().min(1).max(31),
  leadDays: z.number().int().min(0).max(60).default(5),
  isActive: z.boolean().optional(),
  notes: z.string().max(2000).optional().nullable(),
});
export const updateIssuanceAlarmSchema = createIssuanceAlarmSchema.omit({ entityId: true }).partial();
export const issuanceDeadlineFilterSchema = z.object({
  entityId: uuid.optional(),
  /** horizonte em dias para "próximos" (padrão 30) */
  days: z.coerce.number().int().min(1).max(120).default(30),
});

// ---------- Cadastro Público (Fase 1 CRM) ----------
export const createPublicAgentSchema = z.object({
  name: z.string().min(2).max(160),
  position: z.string().min(2).max(120),
  party: z.string().max(40).optional().nullable(),
  termStart: isoDate.optional().nullable(),
  termEnd: isoDate.optional().nullable(),
  email: z.string().email().max(200).optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  whatsapp: z.string().max(30).optional().nullable(),
  isDecisionMaker: z.boolean().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().max(2000).optional().nullable(),
});
export const updatePublicAgentSchema = createPublicAgentSchema.partial();

/** Importação de municípios do IBGE como entidades (lead). `dryRun` só devolve a prévia. */
export const importIbgeSchema = z.object({
  uf: uf,
  types: z.array(z.enum(['PM', 'CM'])).min(1).default(['PM', 'CM']),
  dryRun: z.boolean().default(true),
  /** População mínima (opcional) — filtro aplicado quando o IBGE devolver população */
  minPopulation: z.number().int().min(0).optional(),
});

export const createOrganizationSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z.string().min(2).max(60).regex(/^[a-z0-9-]+$/),
  document: z.string().max(20).optional().nullable(),
  adminName: z.string().min(2).max(120),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(12).max(200),
});

// ---------- CRM Comercial (Fase 2) ----------
const money = z.union([z.number(), z.string()]).transform((v) => (typeof v === 'number' ? v.toFixed(2) : v.replace(/\./g, '').replace(',', '.').trim() || '0')).pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, 'Valor inválido'));
export const moneyInput = money;
export const opportunityItemSchema = z.object({
  catalogItemId: uuid.optional().nullable(),
  description: z.string().min(1).max(300),
  quantity: z.union([z.number(), z.string()]).transform((v) => Number(String(v).replace(',', '.'))).pipe(z.number().positive().max(1_000_000)).default(1),
  unitPrice: money,
  recurrence: z.enum(['MONTHLY', 'ONE_TIME', 'YEARLY']).default('MONTHLY'),
});
export const createOpportunitySchema = z.object({
  entityId: uuid,
  pipelineId: uuid.optional(),
  stageId: uuid.optional(),
  title: z.string().min(2).max(200),
  description: z.string().max(4000).optional().nullable(),
  monthlyAmount: money.optional().nullable(),
  oneTimeAmount: money.optional().nullable(),
  termMonths: z.coerce.number().int().min(1).max(120).optional().nullable(),
  probability: z.coerce.number().int().min(0).max(100).optional().nullable(),
  expectedCloseDate: isoDate.optional().nullable(),
  source: z.enum(['PROSPECCAO', 'INDICACAO', 'PARCEIRO', 'LICITACAO', 'RENOVACAO', 'INBOUND', 'OUTRO']).optional().nullable(),
  ownerUserId: uuid.optional().nullable(),
  items: z.array(opportunityItemSchema).max(50).optional(),
});
export const updateOpportunitySchema = createOpportunitySchema.omit({ entityId: true, pipelineId: true, stageId: true }).partial();
export const moveOpportunitySchema = z.object({ stageId: uuid, notes: z.string().max(2000).optional().nullable() });
export const winOpportunitySchema = z.object({ notes: z.string().max(2000).optional().nullable() });
export const loseOpportunitySchema = z.object({ reason: z.string().min(2).max(120), notes: z.string().max(2000).optional().nullable() });
export const reopenOpportunitySchema = z.object({ stageId: uuid.optional(), notes: z.string().max(2000).optional().nullable() });
export const opportunityListFilterSchema = paginationSchema.extend({
  q: z.string().max(120).optional(),
  entityId: uuid.optional(),
  pipelineId: uuid.optional(),
  stageId: uuid.optional(),
  status: z.enum(['OPEN', 'WON', 'LOST']).optional(),
  ownerUserId: z.union([uuid, z.literal('unassigned')]).optional(),
  uf: z.string().length(2).optional(),
  source: z.string().max(30).optional(),
  stalled: boolParam,
  closeFrom: isoDate.optional(),
  closeTo: isoDate.optional(),
  sortBy: z.enum(['updatedAt', 'createdAt', 'expectedCloseDate', 'totalAmount', 'title']).default('updatedAt'),
});
/** Formalização: cria o contrato EM RASCUNHO a partir da oportunidade ganha (nunca ativo sem confirmação explícita). */
export const formalizeOpportunitySchema = z.object({
  number: z.string().min(1).max(60),
  object: z.string().max(500).optional().nullable(),
  monthlyValue: money.optional().nullable(),
  totalValue: money.optional().nullable(),
  startDate: isoDate.optional().nullable(),
  endDate: isoDate.optional().nullable(),
  responsibleUserId: uuid.optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  /** true = o usuário confirmou a contratação e o contrato nasce ATIVO; false (padrão) = rascunho */
  activate: z.boolean().default(false),
  /** Dia do mês para criar o alarme de emissão (opcional, só quando ativo) */
  issuanceDay: z.coerce.number().int().min(1).max(31).optional().nullable(),
});
export const proposalItemSchema = z.object({
  description: z.string().min(1).max(300),
  quantity: z.union([z.number(), z.string()]).transform((v) => Number(String(v).replace(',', '.'))).pipe(z.number().positive().max(1_000_000)).default(1),
  unitPrice: money,
  recurrence: z.enum(['MONTHLY', 'ONE_TIME', 'YEARLY']).default('MONTHLY'),
});
export const createProposalSchema = z.object({
  title: z.string().min(2).max(200),
  validUntil: isoDate.optional().nullable(),
  introduction: z.string().max(6000).optional().nullable(),
  terms: z.string().max(6000).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  items: z.array(proposalItemSchema).min(1).max(50),
  /** copiar itens da oportunidade quando `items` vier vazio não é permitido: o cliente envia os itens explicitamente */
});
export const updateProposalStatusSchema = z.object({ status: z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED']) });
export const catalogItemSchema = z.object({
  code: z.string().max(40).optional().nullable(),
  name: z.string().min(2).max(200),
  description: z.string().max(2000).optional().nullable(),
  category: z.string().max(80).optional().nullable(),
  unitPrice: money,
  recurrence: z.enum(['MONTHLY', 'ONE_TIME', 'YEARLY']).default('MONTHLY'),
  isActive: z.boolean().default(true),
});
export const updateCatalogItemSchema = catalogItemSchema.partial();
export const goalSchema = z.object({
  userId: uuid.optional().nullable(),
  metric: z.enum(['WON_AMOUNT', 'WON_COUNT', 'ACTIVITIES']).default('WON_AMOUNT'),
  periodStart: isoDate,
  periodEnd: isoDate,
  target: money,
  label: z.string().max(120).optional().nullable(),
}).refine((g) => g.periodStart <= g.periodEnd, { message: 'Período inválido', path: ['periodEnd'] });
export const pipelineStageInputSchema = z.object({
  id: uuid.optional(),
  name: z.string().min(1).max(60),
  probability: z.coerce.number().int().min(0).max(100).default(0),
  kind: z.enum(['OPEN', 'WON', 'LOST']).default('OPEN'),
  slaDays: z.coerce.number().int().min(1).max(365).optional().nullable(),
  color: z.string().max(20).optional().nullable(),
});
export const updatePipelineSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  stages: z.array(pipelineStageInputSchema).min(3).max(15).optional(),
});
export const crmDashboardFilterSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  ownerUserId: uuid.optional(),
  pipelineId: uuid.optional(),
  uf: z.string().length(2).optional(),
});

// ---------- Gestão de Contratos (Fase 3) ----------
export const activateContractSchema = z.object({
  startDate: isoDate.optional().nullable(),
  endDate: isoDate.optional().nullable(),
  monthlyValue: decimalString.optional().nullable(),
  /** Dia do mês para criar o alarme de emissão da nota (opcional) */
  issuanceDay: z.coerce.number().int().min(1).max(31).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});
export const terminateContractSchema = z.object({
  date: isoDate,
  reason: z.string().min(2).max(200),
  notes: z.string().max(2000).optional().nullable(),
});
/** Reajuste manual: índice informado pelo usuário e percentual; o novo valor é calculado e registrado como aditivo ADJUSTMENT. */
export const adjustContractSchema = z.object({
  indexName: z.string().min(2).max(40),
  percent: z.coerce.number().min(-100).max(1000),
  effectiveFrom: isoDate,
  signedAt: isoDate.optional().nullable(),
  label: z.string().max(40).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  /** Valor final informado (sobrescreve o cálculo, ex.: arredondamento combinado) */
  newMonthlyValue: decimalString.optional().nullable(),
});
export const renewalDecisionSchema = z.object({
  status: z.enum(['RENEWED', 'NOT_RENEWED', 'CANCELLED']),
  amendmentId: uuid.optional().nullable(),
  newContractId: uuid.optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});
export const renewalListFilterSchema = z.object({ status: z.enum(['OPEN', 'RENEWED', 'NOT_RENEWED', 'CANCELLED']).optional(), entityId: uuid.optional() });

// ---------- Parceiros e Comissões (Fase 4) ----------
export const partnerSchema = z.object({
  name: z.string().min(2).max(160),
  kind: z.enum(['REPRESENTANTE', 'INDICADOR', 'EMPRESA']).default('REPRESENTANTE'),
  document: z.string().max(20).optional().nullable(),
  contactName: z.string().max(120).optional().nullable(),
  email: z.string().email().max(160).optional().nullable().or(z.literal('')),
  phone: z.string().max(30).optional().nullable(),
  whatsapp: z.string().max(30).optional().nullable(),
  userId: uuid.optional().nullable(),
  bankInfo: z.string().max(500).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  isActive: z.boolean().default(true),
});
export const updatePartnerSchema = partnerSchema.partial();
export const commissionRuleSchema = z.object({
  name: z.string().min(2).max(120),
  basis: z.enum(['RECEIVED', 'INVOICED']).default('RECEIVED'),
  percent: z.coerce.number().min(0).max(100),
  entityId: uuid.optional().nullable(),
  contractId: uuid.optional().nullable(),
  startDate: isoDate.optional().nullable(),
  endDate: isoDate.optional().nullable(),
  maxMonths: z.coerce.number().int().min(1).max(240).optional().nullable(),
  isActive: z.boolean().default(true),
  notes: z.string().max(2000).optional().nullable(),
});
export const updateCommissionRuleSchema = commissionRuleSchema.partial();
export const commissionListFilterSchema = paginationSchema.extend({
  partnerId: uuid.optional(),
  status: z.enum(['FORECAST', 'DUE', 'PAID', 'REVERSED']).optional(),
  entityId: uuid.optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});
export const payCommissionsSchema = z.object({
  ids: z.array(uuid).min(1).max(500),
  paidAt: isoDate,
  paymentRef: z.string().max(120).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});
export const linkPartnerEntitiesSchema = z.object({ entityIds: z.array(uuid).min(1).max(500), unlink: z.boolean().default(false) });

// ---------- Licitações (Fase 5) ----------
const isoDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/, 'Data/hora inválida');
export const tenderSchema = z.object({
  entityId: uuid,
  opportunityId: uuid.optional().nullable(),
  modality: z.enum(['PREGAO_ELETRONICO', 'PREGAO_PRESENCIAL', 'CONCORRENCIA', 'DISPENSA', 'INEXIGIBILIDADE', 'CREDENCIAMENTO', 'REGISTRO_PRECOS', 'ADESAO_ATA', 'LEILAO', 'CONCURSO', 'DIALOGO_COMPETITIVO', 'OUTRA']).default('PREGAO_ELETRONICO'),
  number: z.string().min(1).max(60),
  year: z.coerce.number().int().min(2000).max(2100).optional().nullable(),
  officialId: z.string().max(80).optional().nullable(),
  object: z.string().min(3).max(4000),
  estimatedValue: decimalString.optional().nullable(),
  ourProposalValue: decimalString.optional().nullable(),
  publishedAt: isoDate.optional().nullable(),
  proposalDeadline: isoDateTime.optional().nullable(),
  sessionAt: isoDateTime.optional().nullable(),
  portalUrl: z.string().url().max(500).optional().nullable().or(z.literal('')),
  ownerUserId: uuid.optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
});
export const updateTenderSchema = tenderSchema.omit({ entityId: true }).partial();
export const tenderStatusSchema = z.object({
  status: z.enum(['IDENTIFIED', 'ANALYZING', 'PREPARING', 'SUBMITTED', 'IN_SESSION', 'WON', 'LOST', 'HOMOLOGATED', 'CANCELLED', 'DESERTED', 'NOT_PARTICIPATING']),
  notes: z.string().max(2000).optional().nullable(),
  lossReason: z.string().max(200).optional().nullable(),
  winnerValue: decimalString.optional().nullable(),
  ourProposalValue: decimalString.optional().nullable(),
  resultAt: isoDate.optional().nullable(),
  homologatedAt: isoDate.optional().nullable(),
});
export const tenderListFilterSchema = paginationSchema.extend({
  q: z.string().max(120).optional(),
  entityId: uuid.optional(),
  status: z.string().max(30).optional(),
  modality: z.string().max(30).optional(),
  uf: z.string().length(2).optional(),
  open: boolParam,
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export const tenderDeadlineSchema = z.object({
  kind: z.enum(['PUBLICATION', 'QUESTIONS', 'IMPUGNATION', 'PROPOSAL', 'SESSION', 'APPEAL', 'RESULT', 'HOMOLOGATION', 'SIGNATURE', 'OTHER']).default('OTHER'),
  title: z.string().min(2).max(160),
  dueAt: isoDateTime,
  done: z.boolean().optional(),
  notes: z.string().max(2000).optional().nullable(),
});
export const tenderCompetitorSchema = z.object({
  name: z.string().min(2).max(200),
  document: z.string().max(20).optional().nullable(),
  proposalValue: decimalString.optional().nullable(),
  rank: z.coerce.number().int().min(1).max(999).optional().nullable(),
  isWinner: z.boolean().default(false),
  notes: z.string().max(2000).optional().nullable(),
});
export const tenderChecklistItemSchema = z.object({
  title: z.string().min(2).max(200),
  certificateId: uuid.optional().nullable(),
  documentId: uuid.optional().nullable(),
  required: z.boolean().default(true),
  done: z.boolean().default(false),
  notes: z.string().max(2000).optional().nullable(),
});
export const updateTenderChecklistItemSchema = tenderChecklistItemSchema.partial();
export const pncpSearchSchema = z.object({
  uf: z.string().length(2),
  from: isoDate,
  to: isoDate,
  modalities: z.array(z.coerce.number().int().min(1).max(13)).min(1).max(13).default([6, 8, 4]),
  q: z.string().max(120).optional().nullable(),
  onlyLinkedEntities: z.boolean().default(false),
});
export const pncpImportSchema = z.object({
  items: z.array(z.object({ officialId: z.string().min(5).max(80), entityId: uuid.optional().nullable(), createEntity: z.boolean().default(true) })).min(1).max(200),
  uf: z.string().length(2),
  from: isoDate,
  to: isoDate,
  modalities: z.array(z.coerce.number().int().min(1).max(13)).min(1).max(13),
});
/** Formalização a partir de licitação homologada: contrato em rascunho por padrão (mesma regra do CRM). */
export const formalizeTenderSchema = formalizeOpportunitySchema;
