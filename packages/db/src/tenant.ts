/**
 * Isolamento multi-organização (tenant) no Prisma.
 *
 * - `TENANT_MODELS`: modelos com coluna `organizationId` — o filtro é injetado em todas as leituras e
 *   escritas e `organizationId` é preenchido automaticamente em `create/createMany/upsert`.
 * - `CHILD_TENANT_PATHS`: modelos filhos sem a coluna (eventos, versões, aditivos…) — o filtro é
 *   injetado pela relação com o pai (`invoice: { organizationId }`).
 * - Sem organização no contexto, a operação é recusada, salvo em modo plataforma explícito
 *   (login, cron por organização, bootstrap), para que um filtro esquecido falhe em vez de vazar.
 *
 * As funções abaixo são puras (testáveis); `tenantExtension` liga tudo ao Prisma via $extends.
 */
import { Prisma } from '@prisma/client';

export const TENANT_MODELS = new Set<string>([
  'AssistantConversation', 'User', 'Role', 'Entity', 'DataSource', 'SyncRun', 'Contract', 'Invoice', 'SyncConflict', 'DocumentBlob', 'Document',
  'Certificate', 'Contact', 'FinancialTask', 'CollectionCase', 'MessageTemplate', 'OutboundMessage', 'ServiceOrder',
  'SignatureRequest', 'IssuanceAlarm', 'Notification', 'AuditLog', 'PublicAgent', 'EntityHealthSnapshot',
  'Pipeline', 'PipelineStage', 'Opportunity', 'OpportunityItem', 'Proposal', 'CatalogItem', 'Goal', 'ContractRenewal', 'Partner', 'CommissionRule', 'Commission', 'Tender', 'Ticket', 'Campaign', 'Integration', 'IntegrationLog', 'Webhook', 'WaConversation', 'Setting', 'Subscription', 'SubscriptionInvoice', 'ApiKey',
]);

/** Modelos filhos: caminho de relação até um modelo tenant. */
export const CHILD_TENANT_PATHS: Record<string, string> = {
  Session: 'user', UserRole: 'user', RolePermission: 'role', UserPermission: 'user',
  ContractAmendment: 'contract', InvoiceEvent: 'invoice', CertificateVersion: 'certificate', TaskEvent: 'task',
  CollectionAttempt: 'case', ServiceOrderSignatory: 'serviceOrder', ServiceOrderEvent: 'serviceOrder',
  OpportunityEvent: 'opportunity', ProposalItem: 'proposal',
  TenderDeadline: 'tender', TenderCompetitor: 'tender', TenderChecklistItem: 'tender', TenderEvent: 'tender', TicketInteraction: 'ticket', CampaignRecipient: 'campaign', WebhookDelivery: 'webhook', WaMessage: 'conversation',
};

/** Modelos globais (sem tenant): catálogo de permissões, configurações da plataforma, organizações, superadmin. */
export const GLOBAL_MODELS = new Set<string>(['Permission', 'Organization', 'PlatformAdmin', 'Plan', 'RateLimit']);

const READ_OPS = new Set(['findFirst', 'findFirstOrThrow', 'findMany', 'findUnique', 'findUniqueOrThrow', 'count', 'aggregate', 'groupBy', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert']);
const CREATE_OPS = new Set(['create', 'createMany', 'createManyAndReturn', 'upsert']);

export class TenantContextError extends Error {
  constructor(model: string, operation: string) { super(`Operação ${model}.${operation} sem organização no contexto (tenant)`); }
}

type Args = Record<string, unknown>;

function withWhere(args: Args, filter: Args): Args {
  const where = (args['where'] as Args | undefined) ?? {};
  return { ...args, where: { ...where, ...filter } };
}

/**
 * Aplica o tenant aos argumentos de uma operação. `orgId === null` significa modo plataforma (sem filtro).
 * Lança `TenantContextError` quando falta contexto em modelo tenant/filho.
 */
export function applyTenantArgs(model: string, operation: string, args: Args, orgId: string | null | undefined, platformMode = false): Args {
  if (GLOBAL_MODELS.has(model)) return args;
  const isTenant = TENANT_MODELS.has(model);
  const childPath = CHILD_TENANT_PATHS[model];
  if (!isTenant && !childPath) return args;
  if (!orgId) {
    if (platformMode) return args;
    throw new TenantContextError(model, operation);
  }
  let out = args;
  if (isTenant) {
    if (READ_OPS.has(operation)) out = withWhere(out, { organizationId: orgId });
    if (CREATE_OPS.has(operation)) {
      if (operation === 'createMany' || operation === 'createManyAndReturn') {
        const data = out['data'];
        out = { ...out, data: Array.isArray(data) ? data.map((d) => ({ ...(d as Args), organizationId: orgId })) : { ...(data as Args), organizationId: orgId } };
      } else if (operation === 'upsert') {
        out = { ...out, create: { ...((out['create'] as Args) ?? {}), organizationId: orgId } };
      } else {
        out = { ...out, data: { ...((out['data'] as Args) ?? {}), organizationId: orgId } };
      }
    }
    return out;
  }
  // filho: filtra pela relação com o pai (só leituras/escritas com where)
  if (READ_OPS.has(operation)) {
    // preserva filtros já informados na relação com o pai (ex.: `tender: { deletedAt: null }`)
    const where = (out['where'] as Args | undefined) ?? {};
    const existing = where[childPath!];
    const parent = existing && typeof existing === 'object' && !Array.isArray(existing) ? { ...(existing as Args), organizationId: orgId } : { organizationId: orgId };
    out = { ...out, where: { ...where, [childPath!]: parent } };
  }
  return out;
}

export interface TenantContext { organizationId: string | null; platform: boolean }

/**
 * Campos de chave estrangeira cujo alvo é um modelo tenant: um id vindo do cliente precisa pertencer à mesma organização.
 * A verificação acontece na borda da API (`json()` em apps/web/src/server/http.ts) sobre o corpo já validado, para que
 * jobs internos e transações (que criam e referenciam registros no mesmo passo) não sejam afetados.
 */
export const TENANT_REFS: Record<string, string> = {
  entityId: 'Entity', contractId: 'Contract', newContractId: 'Contract', invoiceId: 'Invoice', contactId: 'Contact', partnerId: 'Partner',
  opportunityId: 'Opportunity', tenderId: 'Tender', ticketId: 'Ticket', serviceOrderId: 'ServiceOrder', documentId: 'Document', signedDocumentId: 'Document',
  pipelineId: 'Pipeline', stageId: 'PipelineStage', catalogItemId: 'CatalogItem', dataSourceId: 'DataSource', certificateId: 'Certificate',
  campaignId: 'Campaign', conversationId: 'WaConversation', templateId: 'MessageTemplate', ruleId: 'CommissionRule', webhookId: 'Webhook',
  taskId: 'FinancialTask', outboundMessageId: 'OutboundMessage', blobId: 'DocumentBlob', roleId: 'Role',
  userId: 'User', assigneeUserId: 'User', responsibleUserId: 'User', ownerUserId: 'User', createdByUserId: 'User', updatedByUserId: 'User',
  requestedByUserId: 'User', decidedByUserId: 'User', paidByUserId: 'User', performedByUserId: 'User', sentByUserId: 'User',
  registeredByUserId: 'User', uploadedByUserId: 'User', overriddenByUserId: 'User', resolvedByUserId: 'User',
};
/** Relações aninhadas `{ connect: { id } }` → modelo alvo (mesmo critério). */
const RELATION_REFS: Record<string, string> = { entity: 'Entity', contract: 'Contract', invoice: 'Invoice', contact: 'Contact', partner: 'Partner', opportunity: 'Opportunity', tender: 'Tender', ticket: 'Ticket', serviceOrder: 'ServiceOrder', document: 'Document', pipeline: 'Pipeline', stage: 'PipelineStage', user: 'User', assignee: 'User', owner: 'User', responsible: 'User', createdBy: 'User', role: 'Role' };

export class TenantReferenceError extends Error {
  constructor(public readonly field: string, public readonly targetModel: string, public readonly id: string) {
    super(`Referência ${field} (${targetModel}) não pertence à organização atual`);
    this.name = 'TenantReferenceError';
  }
}

/** Extrai as referências a validar de um `data` de create/update (campos *_Id e `connect: { id }`). */
export function collectTenantRefs(data: unknown): Array<{ field: string; model: string; id: string }> {
  const out: Array<{ field: string; model: string; id: string }> = [];
  const visit = (d: unknown): void => {
    if (!d || typeof d !== 'object') return;
    for (const [k, v] of Object.entries(d as Record<string, unknown>)) {
      const model = TENANT_REFS[k] ?? (k.endsWith('Ids') ? TENANT_REFS[k.slice(0, -3) + 'Id'] : undefined);
      if (model && typeof v === 'string' && v) out.push({ field: k, model, id: v });
      else if (model && Array.isArray(v)) v.forEach((x, i) => { if (typeof x === 'string' && x) out.push({ field: `${k}.${i}`, model, id: x }); });
      else if (Array.isArray(v)) v.forEach(visit);
      else if (model && v && typeof v === 'object' && typeof (v as { set?: unknown }).set === 'string') out.push({ field: k, model, id: (v as { set: string }).set });
      const rel = RELATION_REFS[k];
      if (rel && v && typeof v === 'object') { const c = (v as { connect?: { id?: unknown } }).connect; if (c && typeof c.id === 'string') out.push({ field: k, model: rel, id: c.id }); }
    }
  };
  if (Array.isArray(data)) data.forEach(visit); else visit(data);
  return out;
}

/** Extensão do Prisma: `resolve()` devolve o contexto atual (AsyncLocalStorage no app). */
export function tenantExtension(resolve: () => TenantContext | undefined) {
  return Prisma.defineExtension({
    name: 'tenant',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const ctx = resolve();
          const next = applyTenantArgs(model, operation, (args ?? {}) as Args, ctx?.organizationId ?? null, ctx?.platform ?? false);
          return query(next as typeof args);
        },
      },
    },
  });
}
