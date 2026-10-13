/**
 * Integrações externas (Fase 8): catálogo de integrações, configuração por organização (segredos cifrados),
 * resolução de configuração (banco → variáveis de ambiente), log de chamadas sem segredos,
 * tentativas controladas/circuit breaker e teste de conexão. Nunca marca uma ação como concluída sem
 * confirmação real do provedor.
 */
import type { Prisma } from '@siow/db';
import { prisma } from '../db.js';
import { currentOrgId, currentOrgIdOrNull } from '../tenant.js';
import { audit } from '../audit.js';
import { env } from '../env.js';
import { decryptSecret, encryptSecret, maskSecret } from '../crypto.js';
import { badRequest, notFound, type Ctx } from '../http.js';

export type IntegrationKey = 'WHATSAPP' | 'EMAIL' | 'SIGNATURE' | 'CNPJ' | 'IBGE' | 'PNCP' | 'COMPRASGOV' | 'SPEECH';
export interface FieldDef { key: string; label: string; secret?: boolean; placeholder?: string; help?: string; required?: boolean }
export interface IntegrationDef { key: IntegrationKey; label: string; description: string; providers: Array<{ key: string; label: string; fields: FieldDef[] }>; manualFallback: string | null }

/** Catálogo: o que cada integração precisa. Campos `secret` são cifrados e nunca devolvidos. */
export const INTEGRATIONS: IntegrationDef[] = [
  { key: 'WHATSAPP', label: 'WhatsApp Business API', description: 'Envio de mensagens (cobrança, atendimento, campanhas) pela Cloud API da Meta e recebimento por webhook.', manualFallback: 'Sem provedor, cada mensagem fica para envio manual (link wa.me) e o usuário confirma o envio.',
    providers: [{ key: 'whatsapp-cloud', label: 'Meta WhatsApp Cloud API', fields: [{ key: 'phoneId', label: 'Phone number ID', required: true }, { key: 'wabaId', label: 'WhatsApp Business Account ID (para modelos aprovados)' }, { key: 'apiUrl', label: 'URL da API', placeholder: 'https://graph.facebook.com/v21.0' }, { key: 'verifyToken', label: 'Verify token do webhook', help: 'Usado pela Meta ao validar a URL /api/webhooks/whatsapp' }, { key: 'token', label: 'Access token', secret: true, required: true }, { key: 'appSecret', label: 'App secret (assinatura do webhook)', secret: true }] }] },
  { key: 'EMAIL', label: 'E-mail (SMTP)', description: 'Envio de e-mails de cobrança, atendimento, campanhas e avisos.', manualFallback: 'Sem provedor, o sistema gera link mailto: para envio manual.',
    providers: [{ key: 'smtp', label: 'SMTP', fields: [{ key: 'host', label: 'Servidor SMTP', required: true }, { key: 'port', label: 'Porta', placeholder: '587' }, { key: 'from', label: 'Remetente (From)', required: true, placeholder: 'Siow System <financeiro@siowsystem.com.br>' }, { key: 'user', label: 'Usuário' }, { key: 'pass', label: 'Senha', secret: true }] }] },
  { key: 'SIGNATURE', label: 'Assinatura eletrônica', description: 'Envio de ordens de serviço para assinatura e recebimento do documento assinado por webhook.', manualFallback: 'Sem provedor, a OS assinada é registrada manualmente (upload com checksum e signatários).',
    providers: [{ key: 'clicksign', label: 'Clicksign', fields: [{ key: 'apiUrl', label: 'URL da API', placeholder: 'https://app.clicksign.com' }, { key: 'accessToken', label: 'Access token', secret: true, required: true }, { key: 'webhookSecret', label: 'Segredo do webhook (HMAC)', secret: true }] }] },
  { key: 'CNPJ', label: 'Consulta de CNPJ', description: 'Preenche nome, município e UF da entidade a partir do CNPJ (fonte pública autorizada).', manualFallback: null,
    providers: [{ key: 'brasilapi', label: 'BrasilAPI (dados da Receita Federal)', fields: [{ key: 'apiUrl', label: 'URL da API', placeholder: 'https://brasilapi.com.br/api/cnpj/v1' }] }] },
  { key: 'IBGE', label: 'IBGE — Localidades', description: 'Lista de municípios por UF com código IBGE (preenchimento no cadastro).', manualFallback: null,
    providers: [{ key: 'ibge', label: 'API pública do IBGE', fields: [] }] },
  { key: 'PNCP', label: 'PNCP — Portal Nacional de Contratações Públicas', description: 'Consulta pública de licitações para importação no módulo Licitações.', manualFallback: null,
    providers: [{ key: 'pncp', label: 'API de consulta do PNCP', fields: [{ key: 'apiUrl', label: 'URL da API', placeholder: 'https://pncp.gov.br/api/consulta/v1' }] }] },
  { key: 'SPEECH', label: 'Transcrição de fala (áudio → texto)', description: 'Converte áudio em texto: ditado por voz no Assistente e transcrição automática dos áudios recebidos pelo WhatsApp. Sem provedor, o Assistente usa o reconhecimento de voz do próprio navegador (quando disponível) e os áudios do WhatsApp ficam só como anexo.', manualFallback: 'Sem provedor, o ditado usa o reconhecimento do navegador (Chrome/Edge) e os áudios do WhatsApp não são transcritos.',
    providers: [{ key: 'whisper', label: 'API compatível com Whisper (OpenAI, Groq e similares)', fields: [{ key: 'apiUrl', label: 'URL base da API', placeholder: 'https://api.openai.com/v1', help: 'Groq: https://api.groq.com/openai/v1' }, { key: 'apiKey', label: 'Chave da API', secret: true, required: true }, { key: 'model', label: 'Modelo', placeholder: 'whisper-1', help: 'Groq: whisper-large-v3' }] }] },
  { key: 'COMPRASGOV', label: 'Compras.gov.br — Dados abertos', description: 'Consulta de contratações publicadas (módulo de contratações da Lei 14.133) para importação no módulo Licitações.', manualFallback: null,
    providers: [{ key: 'comprasgov', label: 'API de dados abertos do Compras.gov.br', fields: [{ key: 'apiUrl', label: 'URL da API', placeholder: 'https://dadosabertos.compras.gov.br' }] }] },
];
const defOf = (key: string): IntegrationDef => { const d = INTEGRATIONS.find((i) => i.key === key); if (!d) throw badRequest(`Integração desconhecida: ${key}`); return d; };

export interface ResolvedConfig { key: IntegrationKey; provider: string; enabled: boolean; configured: boolean; source: 'db' | 'env' | 'none'; config: Record<string, string>; circuitOpen: boolean }

const cache = new Map<string, { at: number; value: ResolvedConfig }>();
export function invalidateCache(): void { cache.clear(); }

/** Fallback nas variáveis de ambiente (compatibilidade com a configuração anterior). */
function envConfig(key: IntegrationKey): { provider: string; config: Record<string, string> } | null {
  const e = env();
  if (key === 'WHATSAPP') { const phoneId = e.WHATSAPP_PHONE_ID ?? process.env['WHATSAPP_PHONE_NUMBER_ID']; const token = e.WHATSAPP_TOKEN ?? process.env['WHATSAPP_ACCESS_TOKEN']; return phoneId && token ? { provider: 'whatsapp-cloud', config: { phoneId, token, apiUrl: e.WHATSAPP_API_URL ?? 'https://graph.facebook.com/v21.0', verifyToken: process.env['WHATSAPP_VERIFY_TOKEN'] ?? '' } } : null; }
  if (key === 'EMAIL') return e.SMTP_HOST && e.SMTP_FROM ? { provider: 'smtp', config: { host: e.SMTP_HOST, port: String(e.SMTP_PORT ?? 587), from: e.SMTP_FROM, user: e.SMTP_USER ?? '', pass: e.SMTP_PASS ?? '' } } : null;
  if (key === 'SIGNATURE') return process.env['CLICKSIGN_ACCESS_TOKEN'] ? { provider: 'clicksign', config: { apiUrl: process.env['CLICKSIGN_API_URL'] ?? 'https://app.clicksign.com', accessToken: process.env['CLICKSIGN_ACCESS_TOKEN']!, webhookSecret: process.env['CLICKSIGN_WEBHOOK_SECRET'] ?? '' } } : null;
  return null;
}
const PUBLIC_DEFAULT: Partial<Record<IntegrationKey, { provider: string; config: Record<string, string> }>> = {
  CNPJ: { provider: 'brasilapi', config: { apiUrl: 'https://brasilapi.com.br/api/cnpj/v1' } },
  IBGE: { provider: 'ibge', config: {} },
  PNCP: { provider: 'pncp', config: { apiUrl: 'https://pncp.gov.br/api/consulta/v1' } },
  COMPRASGOV: { provider: 'comprasgov', config: { apiUrl: 'https://dadosabertos.compras.gov.br' } },
};

/** Configuração efetiva (segredos decifrados) — só para uso no servidor. */
export async function resolve(key: IntegrationKey): Promise<ResolvedConfig> {
  const org = currentOrgIdOrNull() ?? 'platform';
  const ck = `${org}:${key}`; const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  const def = defOf(key);
  const row = currentOrgIdOrNull() ? await prisma.integration.findFirst({ where: { key } }) : null;
  let out: ResolvedConfig;
  if (row && row.isEnabled) {
    const cfg: Record<string, string> = { ...(row.config as Record<string, string>) };
    for (const [k, v] of Object.entries((row.secrets ?? {}) as Record<string, string>)) if (v) cfg[k] = decryptSecret(v);
    const prov = def.providers.find((p) => p.key === row.provider) ?? def.providers[0]!;
    const required = prov.fields.filter((f) => f.required).every((f) => Boolean(cfg[f.key]));
    out = { key, provider: row.provider, enabled: true, configured: required, source: 'db', config: cfg, circuitOpen: Boolean(row.circuitOpenUntil && row.circuitOpenUntil > new Date()) };
  } else if (row && !row.isEnabled) {
    out = { key, provider: row.provider, enabled: false, configured: false, source: 'db', config: {}, circuitOpen: false };
  } else {
    const fromEnv = envConfig(key) ?? PUBLIC_DEFAULT[key] ?? null;
    out = fromEnv ? { key, provider: fromEnv.provider, enabled: true, configured: true, source: PUBLIC_DEFAULT[key] && !envConfig(key) ? 'none' : 'env', config: fromEnv.config, circuitOpen: false } : { key, provider: def.providers[0]!.key, enabled: false, configured: false, source: 'none', config: {}, circuitOpen: false };
    if (PUBLIC_DEFAULT[key] && !envConfig(key)) out.source = 'none';
  }
  cache.set(ck, { at: Date.now(), value: out });
  return out;
}

// ---------------- administração ----------------
export interface IntegrationView { key: IntegrationKey; label: string; description: string; manualFallback: string | null; providers: IntegrationDef['providers']; provider: string; isEnabled: boolean; status: string; source: string; configured: boolean; config: Record<string, string>; secrets: Record<string, string | null>; lastTestAt: string | null; lastTestOk: boolean | null; lastError: string | null; consecutiveFailures: number; circuitOpenUntil: string | null; updatedAt: string | null }

export async function list(): Promise<IntegrationView[]> {
  const rows = await prisma.integration.findMany();
  const out: IntegrationView[] = [];
  for (const def of INTEGRATIONS) {
    const row = rows.find((r) => r.key === def.key) ?? null;
    const resolved = await resolve(def.key);
    const prov = def.providers.find((p) => p.key === (row?.provider ?? resolved.provider)) ?? def.providers[0]!;
    const secrets: Record<string, string | null> = {};
    for (const f of prov.fields.filter((x) => x.secret)) secrets[f.key] = maskSecret(resolved.config[f.key]);
    const config: Record<string, string> = {};
    for (const f of prov.fields.filter((x) => !x.secret)) config[f.key] = resolved.config[f.key] ?? (row?.config as Record<string, string> | null)?.[f.key] ?? '';
    out.push({ key: def.key, label: def.label, description: def.description, manualFallback: def.manualFallback, providers: def.providers, provider: prov.key, isEnabled: row?.isEnabled ?? resolved.enabled, status: row?.status ?? (resolved.configured ? (resolved.source === 'env' ? 'CONFIGURED' : def.key in PUBLIC_DEFAULT ? 'CONFIGURED' : 'NOT_CONFIGURED') : 'NOT_CONFIGURED'), source: resolved.source === 'none' && def.key in PUBLIC_DEFAULT ? 'default' : resolved.source, configured: resolved.configured, config, secrets, lastTestAt: row?.lastTestAt?.toISOString() ?? null, lastTestOk: row?.lastTestOk ?? null, lastError: row?.lastError ?? null, consecutiveFailures: row?.consecutiveFailures ?? 0, circuitOpenUntil: row?.circuitOpenUntil?.toISOString() ?? null, updatedAt: row?.updatedAt?.toISOString() ?? null });
  }
  return out;
}

export async function upsert(ctx: Ctx, key: IntegrationKey, input: { provider?: string; isEnabled?: boolean; config?: Record<string, string>; secrets?: Record<string, string> }): Promise<IntegrationView> {
  const def = defOf(key);
  const provider = input.provider ?? def.providers[0]!.key;
  const prov = def.providers.find((p) => p.key === provider); if (!prov) throw badRequest('Provedor inválido para esta integração');
  const before = await prisma.integration.findFirst({ where: { key } });
  const config: Record<string, string> = { ...((before?.config as Record<string, string>) ?? {}) };
  for (const f of prov.fields.filter((x) => !x.secret)) if (input.config && f.key in input.config) config[f.key] = String(input.config[f.key] ?? '').trim();
  const secrets: Record<string, string> = { ...((before?.secrets as Record<string, string>) ?? {}) };
  for (const f of prov.fields.filter((x) => x.secret)) { const v = input.secrets?.[f.key]; if (v === undefined) continue; secrets[f.key] = v === '' ? '' : encryptSecret(v); } // vazio = apagar; ausente = manter
  const plain: Record<string, string> = { ...config }; for (const [k, v] of Object.entries(secrets)) if (v) plain[k] = decryptSecret(v);
  const configured = prov.fields.filter((f) => f.required).every((f) => Boolean(plain[f.key]));
  const row = await prisma.integration.upsert({
    where: { organizationId_key: { organizationId: currentOrgId(), key } },
    create: { organizationId: currentOrgId(), key, provider, isEnabled: input.isEnabled ?? true, config: config as Prisma.InputJsonValue, secrets: secrets as Prisma.InputJsonValue, status: configured ? 'CONFIGURED' : 'NOT_CONFIGURED', updatedByUserId: ctx.user.id },
    update: { provider, isEnabled: input.isEnabled ?? before?.isEnabled ?? true, config: config as Prisma.InputJsonValue, secrets: secrets as Prisma.InputJsonValue, status: configured ? 'CONFIGURED' : 'NOT_CONFIGURED', consecutiveFailures: 0, circuitOpenUntil: null, updatedByUserId: ctx.user.id },
  });
  invalidateCache();
  await audit(ctx, { action: before ? 'UPDATE' : 'CREATE', resource: 'integration', resourceId: row.id, before: before ? { provider: before.provider, isEnabled: before.isEnabled, config: before.config } : undefined, after: { key, provider, isEnabled: row.isEnabled, config, secretsChanged: Object.keys(input.secrets ?? {}) } });
  return (await list()).find((i) => i.key === key)!;
}

// ---------------- log, falhas e circuit breaker ----------------
const SECRET_RE = /(token|secret|pass|authorization|apikey|api_key|key)$/i;
export function scrub(v: unknown, depth = 0): unknown {
  if (depth > 4) return '[…]';
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => scrub(x, depth + 1));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).slice(0, 40).map(([k, x]) => [k, SECRET_RE.test(k) ? '[oculto]' : scrub(x, depth + 1)]));
  if (typeof v === 'string') return v.length > 2000 ? `${v.slice(0, 2000)}…` : v;
  return v;
}
export async function log(e: { key: IntegrationKey | string; provider: string; action: string; status: 'OK' | 'FAILED' | 'SKIPPED' | 'MANUAL'; attempt?: number; durationMs?: number; request?: unknown; response?: unknown; error?: string | null; referenceType?: string; referenceId?: string; idempotencyKey?: string }): Promise<void> {
  const org = currentOrgIdOrNull(); if (!org) return;
  await prisma.integrationLog.create({ data: { organizationId: org, integrationKey: e.key, provider: e.provider, action: e.action, status: e.status, attempt: e.attempt ?? 1, durationMs: e.durationMs ?? null, request: scrub(e.request) as Prisma.InputJsonValue, response: scrub(e.response) as Prisma.InputJsonValue, error: e.error?.slice(0, 1000) ?? null, referenceType: e.referenceType ?? null, referenceId: e.referenceId ?? null, idempotencyKey: e.idempotencyKey ?? null } }).catch((err) => console.error('integration log failed', err));
}
/** Falha consecutiva: a partir de 5, abre o circuito por 15 minutos (fluxo cai para manual). */
export async function recordOutcome(key: IntegrationKey, ok: boolean, error?: string | null): Promise<void> {
  const org = currentOrgIdOrNull(); if (!org) return;
  const row = await prisma.integration.findFirst({ where: { key } }); if (!row) return;
  if (ok) { if (row.consecutiveFailures || row.circuitOpenUntil || row.status === 'ERROR') await prisma.integration.update({ where: { id: row.id }, data: { consecutiveFailures: 0, circuitOpenUntil: null, status: 'CONFIGURED', lastError: null } }); }
  else { const n = row.consecutiveFailures + 1; await prisma.integration.update({ where: { id: row.id }, data: { consecutiveFailures: n, lastError: error?.slice(0, 500) ?? null, status: n >= 5 ? 'ERROR' : row.status, circuitOpenUntil: n >= 5 ? new Date(Date.now() + 15 * 60_000) : row.circuitOpenUntil } }); }
  invalidateCache();
}

/** Executa uma chamada externa com cronômetro, log e contabilização de falhas. */
export async function call<T>(key: IntegrationKey, action: string, meta: { request?: unknown; referenceType?: string; referenceId?: string; idempotencyKey?: string }, fn: () => Promise<{ result: T; response?: unknown; ok?: boolean }>): Promise<T> {
  const cfg = await resolve(key); const t0 = Date.now();
  try {
    const r = await fn();
    const ok = r.ok ?? true;
    await log({ key, provider: cfg.provider, action, status: ok ? 'OK' : 'FAILED', durationMs: Date.now() - t0, request: meta.request, response: r.response, referenceType: meta.referenceType, referenceId: meta.referenceId, idempotencyKey: meta.idempotencyKey });
    await recordOutcome(key, ok, ok ? null : 'Provedor não confirmou');
    return r.result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await log({ key, provider: cfg.provider, action, status: 'FAILED', durationMs: Date.now() - t0, request: meta.request, error: msg, referenceType: meta.referenceType, referenceId: meta.referenceId, idempotencyKey: meta.idempotencyKey });
    await recordOutcome(key, false, msg);
    throw e;
  }
}

export async function logs(f: { key?: string; status?: string; page: number; pageSize: number }): Promise<{ items: Array<{ id: string; integrationKey: string; provider: string; action: string; status: string; attempt: number; durationMs: number | null; error: string | null; referenceType: string | null; referenceId: string | null; createdAt: string; request: unknown; response: unknown }>; total: number }> {
  const where: Prisma.IntegrationLogWhereInput = { integrationKey: f.key || undefined, status: f.status || undefined };
  const [rows, total] = await Promise.all([prisma.integrationLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (f.page - 1) * f.pageSize, take: f.pageSize }), prisma.integrationLog.count({ where })]);
  return { items: rows.map((r) => ({ id: r.id, integrationKey: r.integrationKey, provider: r.provider, action: r.action, status: r.status, attempt: r.attempt, durationMs: r.durationMs, error: r.error, referenceType: r.referenceType, referenceId: r.referenceId, createdAt: r.createdAt.toISOString(), request: r.request, response: r.response })), total };
}

// ---------------- teste de conexão ----------------
export async function test(ctx: Ctx, key: IntegrationKey): Promise<{ ok: boolean; message: string; details?: unknown }> {
  const cfg = await resolve(key); const t0 = Date.now();
  let res: { ok: boolean; message: string; details?: unknown };
  try {
    if (!cfg.enabled) res = { ok: false, message: 'Integração desativada' };
    else if (!cfg.configured) res = { ok: false, message: 'Campos obrigatórios não preenchidos' };
    else res = await (await import('../integrations/testers.js')).runTest(key, cfg);
  } catch (e) { res = { ok: false, message: e instanceof Error ? e.message : String(e) }; }
  const row = await prisma.integration.findFirst({ where: { key } });
  if (row) await prisma.integration.update({ where: { id: row.id }, data: { lastTestAt: new Date(), lastTestOk: res.ok, lastError: res.ok ? null : res.message, status: res.ok ? 'CONFIGURED' : row.status === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'ERROR', consecutiveFailures: res.ok ? 0 : row.consecutiveFailures, circuitOpenUntil: res.ok ? null : row.circuitOpenUntil } });
  await log({ key, provider: cfg.provider, action: 'TEST', status: res.ok ? 'OK' : 'FAILED', durationMs: Date.now() - t0, response: res.details, error: res.ok ? null : res.message });
  await audit(ctx, { action: 'INTEGRATION_TEST', resource: 'integration', resourceId: key, after: { ok: res.ok, message: res.message } });
  invalidateCache();
  return res;
}
export async function getOrThrow(key: IntegrationKey): Promise<ResolvedConfig> { const c = await resolve(key); if (!c.enabled || !c.configured) throw notFound(`Integração ${key} não configurada`); return c; }
