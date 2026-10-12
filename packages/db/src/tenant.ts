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
  'User', 'Role', 'Entity', 'DataSource', 'SyncRun', 'Contract', 'Invoice', 'SyncConflict', 'DocumentBlob', 'Document',
  'Certificate', 'Contact', 'FinancialTask', 'CollectionCase', 'MessageTemplate', 'OutboundMessage', 'ServiceOrder',
  'SignatureRequest', 'IssuanceAlarm', 'Notification', 'AuditLog', 'PublicAgent', 'EntityHealthSnapshot',
  'Pipeline', 'PipelineStage', 'Opportunity', 'OpportunityItem', 'Proposal', 'CatalogItem', 'Goal', 'ContractRenewal', 'Partner', 'CommissionRule', 'Commission', 'Tender', 'Ticket', 'Campaign',
]);

/** Modelos filhos: caminho de relação até um modelo tenant. */
export const CHILD_TENANT_PATHS: Record<string, string> = {
  Session: 'user', UserRole: 'user', RolePermission: 'role', UserPermission: 'user',
  ContractAmendment: 'contract', InvoiceEvent: 'invoice', CertificateVersion: 'certificate', TaskEvent: 'task',
  CollectionAttempt: 'case', ServiceOrderSignatory: 'serviceOrder', ServiceOrderEvent: 'serviceOrder',
  OpportunityEvent: 'opportunity', ProposalItem: 'proposal',
  TenderDeadline: 'tender', TenderCompetitor: 'tender', TenderChecklistItem: 'tender', TenderEvent: 'tender', TicketInteraction: 'ticket', CampaignRecipient: 'campaign',
};

/** Modelos globais (sem tenant): catálogo de permissões, configurações da plataforma, organizações, superadmin. */
export const GLOBAL_MODELS = new Set<string>(['Permission', 'Setting', 'Organization', 'PlatformAdmin']);

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
