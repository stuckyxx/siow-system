/**
 * Assistente virtual (agente operacional) — Fase 12.
 *
 * Um agente baseado em Claude que opera o sistema inteiro por linguagem natural
 * ("cadastre a Prefeitura de X", "crie um contrato para a Câmara de Y", "abra uma
 * oportunidade…"). Ele NÃO acessa o banco diretamente: toda ação passa pela própria
 * API HTTP do sistema, com os cookies do usuário logado. Assim valem exatamente as
 * mesmas regras de sempre — autenticação, permissões, isolamento por organização,
 * licenciamento de módulos, modo somente leitura e trilha de auditoria.
 *
 * Ações sensíveis (exclusões, baixas financeiras, envios de mensagens, sincronização,
 * usuários/configurações) exigem confirmação explícita do usuário na interface: a
 * ferramenta devolve um token HMAC da ação pretendida e só executa quando o mesmo
 * token volta aprovado na requisição seguinte. O modelo não consegue forjar o token.
 */
import { createHmac } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod/v4';
import { env } from '../env.js';
import { HttpError, type Ctx } from '../http.js';
import { audit } from '../audit.js';
import { prisma } from '../db.js';
import { currentOrgId } from '../tenant.js';
import type { Prisma } from '@siow/db';

export const ASSISTANT_DEFAULT_MODEL = 'claude-opus-5-5';
const MAX_RESULT_CHARS = 14_000;
const MAX_ITERATIONS = 24;

export interface AssistantMessage { role: 'user' | 'assistant'; content: string }
export interface AssistantStep { tool: string; method?: string; path?: string; status?: number; ok: boolean; summary: string; pending?: PendingAction }
export interface PendingAction { token: string; method: string; path: string; body?: unknown; reason: string }
export interface AssistantResult { reply: string; steps: AssistantStep[]; pending: PendingAction[]; stopReason: string | null; usage?: { input: number; output: number }; conversationId?: string }

export function isConfigured(): boolean { return Boolean(process.env.ANTHROPIC_API_KEY); }
export function modelName(): string { return process.env.ASSISTANT_MODEL || ASSISTANT_DEFAULT_MODEL; }

// ---------------------------------------------------------------------------
// Catálogo da API (o que o agente pode operar). Mantido curto e em pt-BR.
// ---------------------------------------------------------------------------
export const API_CATALOG = `
# Convenções
- Todas as rotas são relativas a /api. Listagens aceitam page, pageSize (máx. 200), sortBy, sortDir e devolvem { data ou items, total, page, pageSize } — algumas devolvem um array simples; leia a forma da resposta.
- Datas: "AAAA-MM-DD". Valores monetários: string decimal com ponto, ex. "1500.00" (nunca negativos).
- IDs são UUID. Nunca invente IDs: obtenha-os em uma consulta antes de usar.
- Erros: 400 dados inválidos (campo "issues"), 403 sem permissão/módulo, 404 não encontrado nesta organização, 409 duplicado, 423 organização somente leitura.

# Entidades (clientes: prefeituras, câmaras…)  perm entities.*
GET  /financeiro/entities?q=&type=PM|CM|AUTARQUIA|FUNDO|INSTITUTO|CONSORCIO|OUTRO&uf=&municipality=&isActive=
POST /financeiro/entities { type, name, municipality, uf, shortName?, cnpj?, ibgeCode? (7 dígitos), segment?, notes?, responsibleUserId?, partnerId? }
     Padrão de nome: "PREFEITURA MUNICIPAL DE <MUNICÍPIO>" (PM) / "CÂMARA MUNICIPAL DE <MUNICÍPIO>" (CM); shortName "PM <Município>" / "CM <Município>".
GET  /financeiro/entities/{id} · PATCH /financeiro/entities/{id} {campos parciais} · DELETE /financeiro/entities/{id} (sensível)
GET  /financeiro/entities/{id}/contacts · POST { name, role?, department?, phone?, whatsapp?, email?, isPrimary?, isFinancial? } · PATCH/DELETE /contacts/{contactId}
GET  /financeiro/entities/{id}/agents · POST (agentes públicos) · GET /financeiro/entities/{id}/timeline · GET /financeiro/entities/{id}/health
POST /financeiro/entities/{id}/data-sources { url, label?, syncEnabled? } (portal Assesi/Adois) · POST /financeiro/entities/import-link { url }
GET  /integracoes/lookup/ibge/municipios?uf=MA → [{ id (código IBGE), nome }] · GET /integracoes/lookup/cnpj/{cnpj}

# Contratos  perm contracts.*
GET  /financeiro/contracts?q=&entityId=&status=DRAFT|ACTIVE|SUSPENDED|EXPIRED|TERMINATED
POST /financeiro/contracts { entityId, number, object?, description?, monthlyValue?, totalValue?, startDate?, endDate?, status?, expectsMonthlyBilling?, responsibleUserId?, notes? }
GET/PATCH/DELETE /financeiro/contracts/{id} · POST /financeiro/contracts/{id}/activate · POST /financeiro/contracts/{id}/terminate { reason… } (sensível)
POST /financeiro/contracts/{id}/amendments { kind, justification (≥10 chars), description?, newEndDate?, newMonthlyValue?, adjustmentPercent? }
POST /financeiro/contracts/{id}/adjust (reajuste) · GET /financeiro/contracts/{id}/financial-status · GET /financeiro/contracts/{id}/ledger · GET /financeiro/contracts/renewals

# Notas fiscais / Financeiro (fonte oficial; nunca invente valores)  perm invoices.*
GET  /financeiro/invoices?q=&entityId=&contractId=&status=PENDING|PAID|CANCELLED|UNKNOWN|ALL&year=&month=&competenceFrom=AAAA-MM&competenceTo=&needsReconciliation=
POST /financeiro/invoices { entityId, contractId?, number, competenceMonth, competenceYear, amount, issueDate?, status?, description?, justification (≥10 chars) }  (nota manual)
GET  /financeiro/invoices/{id} · PATCH /financeiro/invoices/{id}/override { status?, paidAt?, paidAmount?, amount?, justification } (sensível)
POST /financeiro/invoices/bulk-status { ids[], status: PAID|PENDING, paidAt?, justification } (sensível) · POST /financeiro/invoices/{id}/reconcile (sensível)
GET  /financeiro/dashboard?… · GET /financeiro/dashboard/forecast · GET /financeiro/collections (cobranças) · POST /financeiro/collections/invoice/{invoiceId}/attempts { channel, notes? }
GET  /financeiro/reports/catalog · GET /financeiro/reports?type=…&… (relatórios) · GET /bi/executive
POST /financeiro/messages/prepare · POST /financeiro/messages/send (sensível: envia WhatsApp/e-mail) · GET /financeiro/messages/templates
GET  /financeiro/certificates (certidões) · POST /financeiro/certificates · GET /financeiro/alarms · POST /financeiro/alarms
GET  /financeiro/service-orders · POST /financeiro/service-orders (ordens de serviço) · POST /financeiro/service-orders/{id}/signature/send (sensível)
GET  /financeiro/sync/overview · POST /financeiro/sync/entities/{id} (sincroniza portal) · POST /financeiro/sync/all (sensível)

# Tarefas  perm tasks.*
GET  /financeiro/tasks?assigneeUserId=&entityId=&status=PENDING|IN_PROGRESS|DONE|CANCELLED&priority=&overdue=&dueFrom=&dueTo=
POST /financeiro/tasks { title, dueDate, description?, type?, priority: LOW|MEDIUM|HIGH|URGENT, entityId?, contractId?, opportunityId?, tenderId?, ticketId?, assigneeUserId?, dueTime "HH:MM"? }
GET/PATCH/DELETE /financeiro/tasks/{id} (PATCH aceita status) · POST /financeiro/tasks/{id}/comments { body } · GET /financeiro/tasks/calendar?from=&to=

# Comercial / CRM (oportunidades = leads)  perm crm.*
GET  /comercial/pipelines → funis com stages[] (use pipeline padrão se o usuário não disser) · GET /comercial/opportunities/board?pipelineId=
GET  /comercial/opportunities?q=&entityId=&status=OPEN|WON|LOST&stageId=&ownerUserId=&uf=
POST /comercial/opportunities { entityId, title, pipelineId?, stageId?, description?, monthlyAmount?, oneTimeAmount?, termMonths?, probability?, expectedCloseDate?, source: PROSPECCAO|INDICACAO|PARCEIRO|LICITACAO|RENOVACAO|INBOUND|OUTRO?, ownerUserId?, items? }
GET/PATCH/DELETE /comercial/opportunities/{id} · POST /comercial/opportunities/{id}/move { stageId, notes? }
POST /comercial/opportunities/{id}/win { notes? } (sensível) · POST /comercial/opportunities/{id}/lose { reason, notes? } (sensível) · POST /comercial/opportunities/{id}/reopen · POST /comercial/opportunities/{id}/formalize (gera contrato; sensível)
GET/POST /comercial/opportunities/{id}/proposals (propostas) · GET /comercial/catalog (produtos/serviços) · GET /comercial/goals (metas) · GET /comercial/dashboard

# Licitações  perm tenders.*
GET  /licitacoes?q=&entityId=&status=&modality=&uf=&open=true
POST /licitacoes { entityId, number, object (≥3 chars), modality: PREGAO_ELETRONICO|PREGAO_PRESENCIAL|CONCORRENCIA|DISPENSA|INEXIGIBILIDADE|CREDENCIAMENTO|REGISTRO_PRECOS|ADESAO_ATA|LEILAO|CONCURSO|DIALOGO_COMPETITIVO|OUTRA, year?, officialId?, estimatedValue?, ourProposalValue?, publishedAt?, proposalDeadline?, sessionAt?, portalUrl?, ownerUserId?, notes? }
GET/PATCH/DELETE /licitacoes/{id} · POST /licitacoes/{id}/status { status: IDENTIFIED|ANALYZING|PREPARING|SUBMITTED|IN_SESSION|WON|LOST|HOMOLOGATED|CANCELLED|DESERTED|NOT_PARTICIPATING, notes? }
POST /licitacoes/{id}/deadlines { kind, title, dueAt } · POST /licitacoes/{id}/checklist { title } · POST /licitacoes/{id}/competitors { name } · GET /licitacoes/calendar
POST /licitacoes/pncp/search { uf?, q?, … } · POST /licitacoes/pncp/import (sensível) · POST /licitacoes/{id}/formalize (sensível)

# Atendimento (chamados)  perm tickets.*
GET  /atendimento/tickets?q=&entityId=&status=&open=true&priority=&assigneeUserId=me|unassigned|{id}
POST /atendimento/tickets { subject (≥3), description?, type: SUPPORT|COMMERCIAL|FINANCIAL|REQUEST|COMPLAINT|VISIT|MEETING|OTHER, channel: WHATSAPP|EMAIL|PHONE|IN_PERSON|PORTAL|OTHER, priority, entityId?, contactId?, contractId?, requesterName?, assigneeUserId? }
GET/PATCH/DELETE /atendimento/tickets/{id} · POST /atendimento/tickets/{id}/status { status: OPEN|IN_PROGRESS|WAITING_CLIENT|WAITING_INTERNAL|RESOLVED|CLOSED|CANCELLED, notes?, resolutionNotes? }
POST /atendimento/tickets/{id}/assign { assigneeUserId } · POST /atendimento/tickets/{id}/interactions { kind: NOTE|REPLY|CALL|EMAIL|WHATSAPP|VISIT|MEETING, body, direction? } · GET /atendimento/tickets/stats
GET  /atendimento/campanhas · POST /atendimento/campanhas · POST /atendimento/campanhas/{id}/run (sensível)
GET  /atendimento/whatsapp/conversations?status=&assigneeUserId= · GET /atendimento/whatsapp/conversations/{id} (mensagens) · POST /atendimento/whatsapp/conversations/{id}/messages { body } (sensível: envia ao cliente) · POST …/{id}/close · POST …/{id}/assign { assigneeUserId }

# Parceiros e comissões  perm partners.*
GET  /parceiros?q= · POST /parceiros { name, kind: REPRESENTANTE|INDICADOR|EMPRESA, document?, contactName?, email?, phone?, whatsapp?, notes? }
GET/PATCH/DELETE /parceiros/{id} · POST /parceiros/{id}/link { entityIds[], unlink? } · GET/POST /parceiros/{id}/rules (regras de comissão) · GET /parceiros/commissions?partnerId=&status= · POST /parceiros/commissions/pay (sensível)

# Documentos, usuários, administração
GET  /documents?entityId=&contractId= · POST /financeiro/contracts/{id}/documents (upload — não disponível pelo assistente; oriente o usuário a anexar pela tela)
GET  /users?… · GET /users/assignees (responsáveis disponíveis: id, name) · POST /users (sensível) · PATCH /users/{id} (sensível)
GET  /notifications · GET /audit?… · GET /settings · GET /integracoes
`.trim();

/** Ações que exigem confirmação explícita do usuário na interface antes de executar. */
const SENSITIVE: Array<{ test: (method: string, path: string) => boolean; reason: string }> = [
  { test: (m) => m === 'DELETE', reason: 'Exclusão de registro' },
  { test: (m, p) => m !== 'GET' && /\/financeiro\/invoices(\/|$)/.test(p) && !/\/invoices$/.test(p), reason: 'Alteração financeira (notas fiscais)' },
  { test: (m, p) => m !== 'GET' && /\/financeiro\/(messages\/send|collections\/charge|sync\/all)/.test(p), reason: 'Envio de mensagens / sincronização geral' },
  { test: (m, p) => m !== 'GET' && /\/financeiro\/contracts\/[^/]+\/(terminate|adjust)/.test(p), reason: 'Alteração contratual relevante' },
  { test: (m, p) => m !== 'GET' && /\/service-orders\/[^/]+\/signature/.test(p), reason: 'Envio para assinatura' },
  { test: (m, p) => m !== 'GET' && /\/comercial\/opportunities\/[^/]+\/(win|lose|formalize)/.test(p), reason: 'Fechamento de oportunidade' },
  { test: (m, p) => m !== 'GET' && /\/licitacoes\/(pncp\/import|[^/]+\/formalize)/.test(p), reason: 'Importação / formalização de licitação' },
  { test: (m, p) => m !== 'GET' && /\/atendimento\/(campanhas\/[^/]+\/run|whatsapp\/)/.test(p), reason: 'Envio de mensagens a clientes' },
  { test: (m, p) => m !== 'GET' && /\/parceiros\/commissions\/(pay|recompute)/.test(p), reason: 'Pagamento / recálculo de comissões' },
  { test: (m, p) => m !== 'GET' && /^\/(users|roles|settings|integracoes|permissions)(\/|$)/.test(p), reason: 'Administração (usuários, perfis, configurações, integrações)' },
  { test: (m, p) => m !== 'GET' && /\/financeiro\/entities\/import/.test(p), reason: 'Importação em lote' },
];
/** Rotas que o assistente nunca chama (autenticação, plataforma, cron, webhooks, uploads). */
const BLOCKED = /^\/(auth|platform|public|cron|webhooks|admin|assistente|health)(\/|$)|\/documents$|\/documents\/[^/]+\/download|\/logo$|\/import$|\/import-sheet$|\/capture-document$/;

export function sensitiveReason(method: string, path: string): string | null {
  for (const s of SENSITIVE) if (s.test(method, path)) return s.reason;
  return null;
}
function canonical(v: unknown): string { return JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x as object).sort().reduce((o, k) => { (o as Record<string, unknown>)[k] = (x as Record<string, unknown>)[k]; return o; }, {} as Record<string, unknown>) : x)) ?? 'null'; }
export function actionToken(userId: string, method: string, path: string, body: unknown): string {
  return createHmac('sha256', env().JWT_ACCESS_SECRET).update(`${userId}\n${method}\n${path}\n${canonical(body ?? null)}`).digest('base64url').slice(0, 24);
}
function normalizePath(raw: string): string {
  let p = raw.trim();
  if (p.startsWith('http')) { try { p = new URL(p).pathname + new URL(raw).search; } catch { /* ignore */ } }
  if (p.startsWith('/api/')) p = p.slice(4);
  if (!p.startsWith('/')) p = '/' + p;
  return p;
}

// ---------------------------------------------------------------------------
// Execução via a própria API (mesma origem, cookies do usuário).
// ---------------------------------------------------------------------------
interface CallResult { status: number; ok: boolean; body: unknown }
async function callApi(ctx: Ctx, method: string, path: string, body?: unknown): Promise<CallResult> {
  const req = ctx.req;
  const proto = req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? req.nextUrl.host;
  const base = env().APP_URL ?? `${proto}://${host}`;
  const url = new URL('/api' + path, base);
  const headers: Record<string, string> = { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json', 'X-Siow-Assistant': '1' };
  const cookie = req.headers.get('cookie'); if (cookie) headers.cookie = cookie;
  const auth = req.headers.get('authorization'); if (auth) headers.authorization = auth;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual', signal: AbortSignal.timeout(50_000) });
  const text = await res.text();
  let parsed: unknown = text;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* texto puro */ }
  return { status: res.status, ok: res.ok, body: parsed };
}
/** Limita o tamanho do resultado mantendo JSON válido: listas grandes são cortadas por itens, com aviso. */
function truncate(v: unknown): string {
  const full = typeof v === 'string' ? v : JSON.stringify(v);
  if (full.length <= MAX_RESULT_CHARS) return full;
  const shrink = (arr: unknown[]): { items: unknown[]; omitted: number } => {
    const out: unknown[] = []; let size = 0;
    for (const it of arr) { const len = JSON.stringify(it).length + 1; if (size + len > MAX_RESULT_CHARS - 400) break; out.push(it); size += len; }
    return { items: out, omitted: arr.length - out.length };
  };
  const wrap = (r: { items: unknown[]; omitted: number }, total: number) => ({ _aviso: `Lista cortada: exibindo ${r.items.length} de ${total} itens (${r.omitted} omitidos). Refine com filtros (q, uf, status…) ou pageSize menor.`, items: r.items });
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.body)) return JSON.stringify({ ...o, body: wrap(shrink(o.body), o.body.length) });
    const b = o.body as Record<string, unknown> | undefined;
    if (b && typeof b === 'object' && Array.isArray(b.data)) { const r = shrink(b.data); return JSON.stringify({ ...o, body: { ...b, data: r.items, _aviso: `Lista cortada: exibindo ${r.items.length} de ${b.data.length} itens desta página (total geral ${String(b.total ?? '?')}). Refine com filtros ou pageSize menor.` } }); }
    if (Array.isArray(v)) return JSON.stringify(wrap(shrink(v), v.length));
  }
  return full.slice(0, MAX_RESULT_CHARS) + `… [truncado: ${full.length} caracteres; refine a consulta com filtros ou pageSize menor]`;
}
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

export function systemPromptForTest(ctx: Ctx, context?: ScreenContext | null): string { return systemPrompt(ctx, context); }
function systemPrompt(ctx: Ctx, context?: ScreenContext | null): string {
  const u = ctx.user;
  const today = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
  const iso = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  const mods = u.access?.modules?.length ? u.access.modules.join(', ') : 'todos';
  return `Você é o Assistente Siow, o operador virtual do Siow System — um CRM e sistema de gestão financeira, comercial, de licitações, atendimento e parcerias voltado a empresas que prestam serviços a prefeituras, câmaras municipais e outros órgãos públicos no Brasil.

Sua função é EXECUTAR o que o usuário pedir operando o sistema por meio das ferramentas (a API interna), de forma inteligente, completa e segura, e responder sempre em português do Brasil, de forma direta e objetiva.

Contexto
- Hoje: ${today} (ISO ${iso}). Fuso: America/Sao_Paulo.
- Usuário: ${u.name} <${u.email}> (id ${u.id}); perfis: ${u.roles.join(', ') || '—'}.
- Organização: ${u.organization.name}. Módulos habilitados: ${mods}.${u.access?.readOnly ? ' ATENÇÃO: organização em modo SOMENTE LEITURA — nenhuma alteração será aceita.' : ''}
- Permissões do usuário: ${u.permissions.join(', ')}.

Como trabalhar
1. Entenda o pedido e planeje. Para qualquer ação que dependa de um registro existente (entidade, contrato, usuário responsável, funil/estágio), CONSULTE antes para obter o id correto — nunca invente IDs, valores ou dados.
2. Antes de cadastrar, verifique duplicidade (ex.: GET /financeiro/entities?q=<município>&uf=). Se já existir, reutilize o registro em vez de duplicar e avise o usuário.
3. Preencha o máximo de campos a partir do que o usuário disse (UF, município, tipo prefeitura/câmara, valores, datas, responsáveis). Use a consulta IBGE para código do município quando cadastrar entidade. Se faltar algo obrigatório que não possa ser deduzido com segurança, pergunte de forma curta — mas prefira concluir o que já for possível.
4. Se o usuário pedir várias coisas (ex.: "cadastre a Prefeitura de X e crie um contrato de R$ 5.000/mês"), execute em sequência, usando o resultado de cada etapa na seguinte.
5. Ações sensíveis (exclusões, baixas/alterações de notas fiscais, envio de mensagens, fechamento de oportunidades, sincronização geral, administração) exigem confirmação do usuário: a ferramenta devolverá "AGUARDANDO_CONFIRMACAO". Nesse caso, explique em uma frase o que será feito e peça que confirme pelo botão — não tente contornar nem chamar de novo. Quando o usuário confirmar, o sistema executa a ação sozinho e o resultado chega a você na mensagem seguinte entre [AÇÃO CONFIRMADA EXECUTADA …]; NÃO repita a chamada — apenas confira o resultado, continue o que faltar e resuma.
6. O Financeiro é a fonte oficial: nunca estime nem invente valores de notas, pagamentos ou saldos; só informe o que a API devolver.
7. Em erro 400, leia "issues" e corrija o corpo; em 403, informe que o usuário não tem permissão/módulo; em 404, o registro não existe nesta organização; em 409, já existe (não duplique).
8. Ao terminar, responda com um resumo claro do que foi feito, incluindo nomes e números relevantes (ex.: nome da entidade criada, número do contrato, título da oportunidade e estágio). Quando útil, cite o caminho na interface (ex.: Entidades, Contratos, Comercial). Não exponha IDs técnicos a menos que o usuário peça.
9. Nunca invente funcionalidades: se algo não existir na API (ex.: upload de arquivos), diga como fazer pela tela.

Catálogo da API
${API_CATALOG}${context ? `

Contexto da tela
O usuário está com este registro aberto: ${context.label} (${context.kind}). Quando ele disser "esta entidade", "este contrato", "esta oportunidade", "este chamado", "esta conversa" ou "o cliente", refere-se a ele. ${CONTEXT_HINTS[context.kind]?.(context.id) ?? ''} Comece consultando o registro quando precisar de dados dele.` : ''}`;
}

// ---------------------------------------------------------------------------
// Execução do agente
// ---------------------------------------------------------------------------
export interface ScreenContext { kind: 'entity' | 'contract' | 'opportunity' | 'ticket' | 'whatsapp' | 'tender'; id: string; label: string; path?: string }
export interface RunInput { messages: AssistantMessage[]; approvals?: PendingAction[]; conversationId?: string | null; inputMode?: 'text' | 'voice'; context?: ScreenContext | null }
const CONTEXT_HINTS: Record<ScreenContext['kind'], (id: string) => string> = {
  entity: (id) => `Entidade (cliente) id ${id}. Dados: GET /financeiro/entities/${id}; contratos: GET /financeiro/contracts?entityId=${id}; notas: GET /financeiro/invoices?entityId=${id}&status=ALL; chamados: GET /atendimento/tickets?entityId=${id}; oportunidades: GET /comercial/opportunities?entityId=${id}; tarefas: GET /financeiro/tasks?entityId=${id}; linha do tempo: GET /financeiro/entities/${id}/timeline; saúde: GET /financeiro/entities/${id}/health. Ao criar contrato/oportunidade/tarefa/chamado para "esta entidade", use entityId=${id}.`,
  contract: (id) => `Contrato id ${id}. Dados: GET /financeiro/contracts/${id}; situação financeira: GET /financeiro/contracts/${id}/financial-status; razão: GET /financeiro/contracts/${id}/ledger; notas: GET /financeiro/invoices?contractId=${id}&status=ALL. Aditivos: POST /financeiro/contracts/${id}/amendments. Ao criar tarefa/chamado para "este contrato", use contractId=${id} e o entityId do contrato.`,
  opportunity: (id) => `Oportunidade (lead) id ${id}. Dados: GET /comercial/opportunities/${id} (inclui entidade, etapa, valores, histórico); funil e etapas: GET /comercial/pipelines. Mover: POST /comercial/opportunities/${id}/move { stageId }; propostas: GET/POST /comercial/opportunities/${id}/proposals; tarefas: use opportunityId=${id}.`,
  ticket: (id) => `Chamado id ${id}. Dados: GET /atendimento/tickets/${id} (inclui interações). Registrar interação: POST /atendimento/tickets/${id}/interactions { kind, body, direction }; mudar situação: POST /atendimento/tickets/${id}/status { status, notes, resolutionNotes }; atribuir: POST /atendimento/tickets/${id}/assign; tarefa: POST /atendimento/tickets/${id}/tasks ou use ticketId=${id}.`,
  whatsapp: (id) => `Conversa do WhatsApp id ${id}. Dados e mensagens: GET /atendimento/whatsapp/conversations/${id}. Responder ao cliente: POST /atendimento/whatsapp/conversations/${id}/messages { body } (ação sensível: o usuário confirma antes do envio). Ao redigir a resposta, seja cordial, objetivo e em português; quando o usuário disser "responda ao cliente que…", escreva a mensagem completa no corpo. Encerrar: POST /atendimento/whatsapp/conversations/${id}/close; atribuir: POST /atendimento/whatsapp/conversations/${id}/assign.`,
  tender: (id) => `Licitação id ${id}. Dados: GET /licitacoes/${id}; prazos: POST /licitacoes/${id}/deadlines; checklist: POST /licitacoes/${id}/checklist; situação: POST /licitacoes/${id}/status; tarefas: use tenderId=${id}.`,
};

// ---------------------------------------------------------------------------
// Histórico de conversas (Fase 13) — por usuário, dentro da organização.
// ---------------------------------------------------------------------------
export interface StoredMessage { role: 'user' | 'assistant'; content: string; steps?: AssistantStep[]; pending?: PendingAction[]; at: string; inputMode?: 'text' | 'voice' }
export interface ConversationSummary { id: string; title: string; messageCount: number; createdAt: Date; updatedAt: Date }
const MAX_STORED_MESSAGES = 200;

export async function listConversations(userId: string): Promise<ConversationSummary[]> {
  return prisma.assistantConversation.findMany({ where: { userId, deletedAt: null }, orderBy: { updatedAt: 'desc' }, take: 50, select: { id: true, title: true, messageCount: true, createdAt: true, updatedAt: true } });
}
export async function getConversation(userId: string, id: string): Promise<ConversationSummary & { messages: StoredMessage[] }> {
  const c = await prisma.assistantConversation.findFirst({ where: { id, userId, deletedAt: null } });
  if (!c) throw new HttpError(404, 'Conversa não encontrada');
  return { id: c.id, title: c.title, messageCount: c.messageCount, createdAt: c.createdAt, updatedAt: c.updatedAt, messages: (Array.isArray(c.messages) ? c.messages : []) as unknown as StoredMessage[] };
}
export async function deleteConversation(ctx: Ctx, id: string): Promise<void> {
  const r = await prisma.assistantConversation.updateMany({ where: { id, userId: ctx.user.id, deletedAt: null }, data: { deletedAt: new Date() } });
  if (!r.count) throw new HttpError(404, 'Conversa não encontrada');
  await audit(ctx, { action: 'assistant.conversation.delete', resource: 'assistantConversation', resourceId: id });
}
/** Acrescenta o turno (pergunta + resposta) à conversa; cria uma nova quando não há id. */
export async function persistTurn(ctx: Ctx, conversationId: string | null | undefined, userMsg: StoredMessage, assistantMsg: StoredMessage, context?: ScreenContext | null): Promise<string> {
  const existing = conversationId ? await prisma.assistantConversation.findFirst({ where: { id: conversationId, userId: ctx.user.id, deletedAt: null } }) : null;
  const prev = (existing && Array.isArray(existing.messages) ? (existing.messages as unknown as StoredMessage[]) : []);
  const messages = [...prev, userMsg, assistantMsg].slice(-MAX_STORED_MESSAGES) as unknown as Prisma.InputJsonValue;
  if (existing) { await prisma.assistantConversation.update({ where: { id: existing.id }, data: { messages, messageCount: prev.length + 2 } }); return existing.id; }
  const title = (context ? `[${context.label.slice(0, 30)}] ` : '') + (userMsg.content.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Conversa');
  const c = await prisma.assistantConversation.create({ data: { organizationId: currentOrgId(), userId: ctx.user.id, title, messages, messageCount: 2 } });
  return c.id;
}


/**
 * Ações sensíveis confirmadas pelo usuário na interface: o token HMAC prova que foi exatamente esta ação que o
 * assistente propôs; o sistema executa aqui (sem passar pelo modelo) e devolve o resultado para informar ao modelo.
 */
export async function executeApproved(ctx: Ctx, approvals: PendingAction[], steps: AssistantStep[]): Promise<string[]> {
  const executed: string[] = [];
  for (const a of approvals.slice(0, 10)) {
    if (!a || typeof a.token !== 'string' || !METHODS.includes(a.method as typeof METHODS[number]) || typeof a.path !== 'string') continue;
    const path = normalizePath(a.path); const body = a.method === 'GET' || a.method === 'DELETE' ? undefined : a.body;
    if (actionToken(ctx.user.id, a.method, path, body ?? null) !== a.token) { steps.push({ tool: 'confirmacao', method: a.method, path, ok: false, summary: 'Confirmação inválida (ação não corresponde à proposta)' }); continue; }
    if (BLOCKED.test(path.split('?')[0]!)) continue;
    let r: CallResult;
    try { r = await callApi(ctx, a.method, path, body); } catch (e) { r = { status: 0, ok: false, body: { message: e instanceof Error ? e.message : String(e) } }; }
    steps.push({ tool: 'confirmacao', method: a.method, path, status: r.status, ok: r.ok, summary: `${a.reason} confirmada: ${a.method} ${path.split('?')[0]}${r.ok ? '' : ' — ' + ((r.body as { message?: string } | null)?.message ?? 'HTTP ' + r.status)}` });
    await audit(ctx, { action: 'assistant.confirmed', resource: 'assistant', resourceId: null, after: { method: a.method, path, status: r.status, body: body ?? null, reason: a.reason } }).catch(() => undefined);
    executed.push(`[AÇÃO CONFIRMADA EXECUTADA pelo sistema: ${a.method} ${path} corpo=${JSON.stringify(body ?? null)} → status ${r.status} ${r.ok ? 'OK' : 'ERRO'}; resultado: ${truncate(r.body).slice(0, 3000)}]`);
  }
  return executed;
}

/** Ferramenta única do agente: chamar a API interna. Exportada para testes sem o modelo. */
export function makeCallTool(ctx: Ctx, steps: AssistantStep[], pending: Map<string, PendingAction>) {
  return betaZodTool({
    name: 'chamar_api',
    description: 'Chama a API interna do Siow System em nome do usuário logado (mesmas permissões e isolamento). Use GET para consultar e POST/PATCH/PUT/DELETE para alterar. O caminho é relativo a /api (ex.: "/financeiro/entities"). Query string pode ir no próprio caminho ou em "query". Resposta: { status, ok, body }. Ações sensíveis retornam AGUARDANDO_CONFIRMACAO com um token — peça a confirmação do usuário e repita a chamada idêntica depois.',
    inputSchema: z.object({
      method: z.enum(METHODS).describe('Método HTTP'),
      path: z.string().min(1).max(400).describe('Caminho relativo a /api, ex.: /financeiro/entities ou /comercial/opportunities/{id}/move'),
      query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().describe('Parâmetros de query (opcional)'),
      body: z.record(z.string(), z.unknown()).optional().describe('Corpo JSON para POST/PUT/PATCH (opcional)'),
      motivo: z.string().max(200).optional().describe('Resumo curto, em português, do objetivo desta chamada (aparece no histórico para o usuário)'),
    }),
    run: async (args) => {
      const method = args.method;
      let path = normalizePath(args.path);
      if (args.query && Object.keys(args.query).length) {
        const u = new URL(path, 'http://x'); for (const [k, v] of Object.entries(args.query)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
        path = u.pathname + u.search;
      }
      const pathOnly = path.split('?')[0]!;
      if (BLOCKED.test(pathOnly)) { steps.push({ tool: 'chamar_api', method, path, ok: false, summary: 'Rota não permitida ao assistente' }); return JSON.stringify({ status: 403, ok: false, body: { message: 'Esta rota não pode ser operada pelo assistente. Oriente o usuário a usar a tela correspondente.' } }); }
      const body = method === 'GET' || method === 'DELETE' ? undefined : args.body;
      const reason = sensitiveReason(method, pathOnly);
      if (reason) {
        const token = actionToken(ctx.user.id, method, path, body ?? null);
        const p: PendingAction = { token, method, path, body, reason };
        pending.set(token, p);
        steps.push({ tool: 'chamar_api', method, path, ok: false, summary: `${args.motivo ?? reason} — aguardando confirmação do usuário`, pending: p });
        return JSON.stringify({ status: 428, ok: false, body: { message: 'AGUARDANDO_CONFIRMACAO: ação sensível (' + reason + '). Explique ao usuário o que será feito e peça a confirmação pelo botão. Não repita a chamada: após confirmar, o sistema executa e lhe informa o resultado.' } });
      }
      let r: CallResult;
      try { r = await callApi(ctx, method, path, body); } catch (e) { const msg = e instanceof Error ? e.message : String(e); steps.push({ tool: 'chamar_api', method, path, ok: false, summary: `Falha de rede: ${msg}` }); return JSON.stringify({ status: 0, ok: false, body: { message: 'Falha ao chamar a API: ' + msg } }); }
      const summary = args.motivo ?? `${method} ${pathOnly}`;
      steps.push({ tool: 'chamar_api', method, path, status: r.status, ok: r.ok, summary: r.ok ? summary : `${summary} — ${(r.body as { message?: string } | null)?.message ?? 'HTTP ' + r.status}` });
      if (method !== 'GET') await audit(ctx, { action: 'assistant.call', resource: 'assistant', resourceId: null, after: { method, path, status: r.status, body: body ?? null, motivo: args.motivo ?? null } }).catch(() => undefined);
      return truncate({ status: r.status, ok: r.ok, body: r.body });
    },
  });
}

export async function run(ctx: Ctx, input: RunInput): Promise<AssistantResult> {
  if (!isConfigured()) throw new HttpError(503, 'Assistente não configurado: defina a variável ANTHROPIC_API_KEY no ambiente.');
  const steps: AssistantStep[] = [];
  const pending = new Map<string, PendingAction>();
  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = input.messages.filter((m) => m.content.trim()).map((m) => ({ role: m.role, content: m.content }));
  if (!messages.length || messages[messages.length - 1]!.role !== 'user') throw new HttpError(400, 'A última mensagem precisa ser do usuário.');
  const executed = await executeApproved(ctx, input.approvals ?? [], steps);
  if (executed.length) { const last = messages[messages.length - 1]!; last.content = executed.join('\n') + '\n\n' + (last.content as string); }
  const callTool = makeCallTool(ctx, steps, pending);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 110_000 });

  const runner = client.beta.messages.toolRunner({
    model: modelName(),
    max_tokens: 8_000,
    // Thinking adaptativo (padrão) com esforço médio: equilíbrio entre qualidade e latência para operação do sistema.
    output_config: { effort: 'medium' },
    system: [{ type: 'text', text: systemPrompt(ctx, input.context), cache_control: { type: 'ephemeral' } }],
    tools: [callTool],
    messages,
    max_iterations: MAX_ITERATIONS,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  } as Parameters<typeof client.beta.messages.toolRunner>[0]);

  let final: Anthropic.Beta.Messages.BetaMessage;
  try { final = await runner.runUntilDone(); }
  catch (e) {
    if (e instanceof Anthropic.APIError) throw new HttpError(502, `Assistente indisponível: o serviço de IA respondeu ${e.status ?? 'erro'}${e.message ? ' — ' + e.message.replace(/\s*\{[\s\S]*$/, '').replace(/^\d{3}\s*/, '').slice(0, 160) : ''}. ${e.status === 401 ? 'Verifique a ANTHROPIC_API_KEY.' : e.status === 429 ? 'Limite do serviço atingido; tente em instantes.' : ''}`.trim());
    throw e;
  }
  const text = final.content.filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
  let reply = text;
  if (final.stop_reason === 'refusal') reply = 'Não posso ajudar com esse pedido. Reformule ou fale com o suporte da Siow System.';
  else if (final.stop_reason === 'max_tokens') reply = (text ? text + '\n\n' : '') + '(Resposta interrompida por limite de tamanho — peça para continuar.)';
  else if (!reply && pending.size) reply = 'Preciso da sua confirmação para prosseguir com a ação indicada abaixo.';
  else if (!reply) reply = 'Concluído.';
  const usage = final.usage ? { input: final.usage.input_tokens ?? 0, output: final.usage.output_tokens ?? 0 } : undefined;
  const pend = Array.from(pending.values());
  const now = new Date().toISOString();
  const lastUser = input.messages[input.messages.length - 1]!;
  let conversationId: string | undefined;
  try { conversationId = await persistTurn(ctx, input.conversationId, { role: 'user', content: lastUser.content, at: now, inputMode: input.inputMode ?? 'text' }, { role: 'assistant', content: reply, steps, pending: pend, at: now }, input.context); }
  catch (e) { console.error('falha ao salvar conversa do assistente', e); }
  return { reply, steps, pending: pend, stopReason: final.stop_reason, usage, conversationId };
}
