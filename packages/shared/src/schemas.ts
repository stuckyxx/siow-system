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
  kind: z.enum(['TERM', 'VALUE', 'OBJECT', 'MIXED', 'OTHER']).default('OTHER'),
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
