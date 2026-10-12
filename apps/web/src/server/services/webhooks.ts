/**
 * Webhooks de saída (Fase 8): assinaturas por organização para eventos da plataforma. Cada evento gera uma
 * entrega por webhook (idempotente por eventId), enviada com assinatura HMAC-SHA256 (X-Siow-Signature),
 * tentativas controladas (backoff 1, 5, 15, 60 e 180 min) e log. Nunca marca entregue sem resposta 2xx.
 */
import { createHmac, randomUUID } from 'node:crypto';
import type { Prisma } from '@siow/db';
import { prisma } from '../db.js';
import { currentOrgId, currentOrgIdOrNull } from '../tenant.js';
import { audit } from '../audit.js';
import { decryptSecret, encryptSecret, maskSecret } from '../crypto.js';
import { badRequest, notFound, type Ctx } from '../http.js';
import { log } from './integrations.js';

export const WEBHOOK_EVENTS = ['ticket.created', 'ticket.resolved', 'opportunity.won', 'opportunity.lost', 'contract.activated', 'contract.terminated', 'invoice.paid', 'tender.status_changed', 'campaign.finished', 'test.ping'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
const BACKOFF_MIN = [1, 5, 15, 60, 180];
const MAX_ATTEMPTS = BACKOFF_MIN.length;

export interface WebhookView { id: string; name: string; url: string; events: string[]; isActive: boolean; hasSecret: boolean; secretMasked: string | null; consecutiveFailures: number; lastDeliveryAt: string | null; lastStatus: string | null; createdAt: string; pending: number; failed: number; sent: number }

const toView = (w: Prisma.WebhookGetPayload<{ include: { deliveries: { select: { status: true } } } }>): WebhookView => ({ id: w.id, name: w.name, url: w.url, events: (w.events as string[]) ?? [], isActive: w.isActive, hasSecret: Boolean(w.secret), secretMasked: w.secret ? maskSecret(decryptSecret(w.secret)) : null, consecutiveFailures: w.consecutiveFailures, lastDeliveryAt: w.lastDeliveryAt?.toISOString() ?? null, lastStatus: w.lastStatus, createdAt: w.createdAt.toISOString(), pending: w.deliveries.filter((d) => d.status === 'PENDING').length, failed: w.deliveries.filter((d) => d.status === 'FAILED').length, sent: w.deliveries.filter((d) => d.status === 'SENT').length });
const include = { deliveries: { select: { status: true } } } satisfies Prisma.WebhookInclude;

export async function list(): Promise<WebhookView[]> { return (await prisma.webhook.findMany({ where: { deletedAt: null }, include, orderBy: { createdAt: 'asc' } })).map(toView); }

export async function upsert(ctx: Ctx, id: string | null, input: { name: string; url: string; events: string[]; isActive?: boolean; secret?: string | null }): Promise<WebhookView> {
  if (!/^https:\/\//.test(input.url) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(input.url)) throw badRequest('A URL do webhook deve usar HTTPS');
  const events = input.events.filter((e) => (WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (!events.length) throw badRequest('Selecione ao menos um evento');
  const data = { name: input.name, url: input.url, events, isActive: input.isActive ?? true, ...(input.secret !== undefined ? { secret: input.secret ? encryptSecret(input.secret) : null } : {}) };
  const w = id ? await prisma.webhook.update({ where: { id }, data, include }) : await prisma.webhook.create({ data: { ...data, organizationId: currentOrgId(), createdByUserId: ctx.user.id, secret: data.secret ?? encryptSecret(randomUUID().replace(/-/g, '')) }, include });
  await audit(ctx, { action: id ? 'UPDATE' : 'CREATE', resource: 'webhook', resourceId: w.id, after: { name: w.name, url: w.url, events } });
  return toView(w);
}
export async function remove(ctx: Ctx, id: string): Promise<void> {
  const w = await prisma.webhook.findFirst({ where: { id, deletedAt: null } }); if (!w) throw notFound('Webhook não encontrado');
  await prisma.webhook.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  await prisma.webhookDelivery.updateMany({ where: { webhookId: id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
  await audit(ctx, { action: 'SOFT_DELETE', resource: 'webhook', resourceId: id, before: { name: w.name, url: w.url } });
}
/** Segredo em claro, só uma vez, para o cliente configurar a validação. */
export async function revealSecret(ctx: Ctx, id: string): Promise<{ secret: string | null }> {
  const w = await prisma.webhook.findFirst({ where: { id, deletedAt: null } }); if (!w) throw notFound('Webhook não encontrado');
  await audit(ctx, { action: 'WEBHOOK_SECRET_REVEALED', resource: 'webhook', resourceId: id });
  return { secret: w.secret ? decryptSecret(w.secret) : null };
}

/** Enfileira o evento para todos os webhooks ativos inscritos; idempotente por (webhook, eventId). Nunca lança. */
export async function emit(event: WebhookEvent, payload: Record<string, unknown>, eventId: string = randomUUID()): Promise<number> {
  try {
    if (!currentOrgIdOrNull()) return 0;
    const hooks = await prisma.webhook.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, events: true } });
    const targets = hooks.filter((h) => ((h.events as string[]) ?? []).includes(event));
    if (!targets.length) return 0;
    const data = { id: eventId, event, occurredAt: new Date().toISOString(), data: payload } as Prisma.InputJsonValue;
    await prisma.webhookDelivery.createMany({ data: targets.map((h) => ({ webhookId: h.id, eventId, event, payload: data })), skipDuplicates: true });
    // tentativa imediata, com teto de tempo; o restante fica para o cron
    void dispatchPending({ limit: targets.length, budgetMs: 8_000 }).catch(() => undefined);
    return targets.length;
  } catch (e) { console.error('webhook emit failed', e); return 0; }
}

export function sign(secret: string, timestamp: string, body: string): string { return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex'); }

async function deliver(d: Prisma.WebhookDeliveryGetPayload<{ include: { webhook: true } }>): Promise<void> {
  const body = JSON.stringify(d.payload); const ts = String(Math.floor(Date.now() / 1000)); const t0 = Date.now();
  const secret = d.webhook.secret ? decryptSecret(d.webhook.secret) : '';
  let ok = false, status: number | null = null, error: string | null = null;
  try {
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(d.webhook.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'SiowSystem-Webhooks/1.0', 'X-Siow-Event': d.event, 'X-Siow-Delivery': d.id, 'X-Siow-Timestamp': ts, 'X-Siow-Signature': secret ? `sha256=${sign(secret, ts, body)}` : '' }, body, signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timer); status = res.status; ok = res.ok; if (!ok) error = `HTTP ${res.status}`;
  } catch (e) { error = e instanceof Error ? e.message : String(e); }
  const attempts = d.attempts + 1; const exhausted = !ok && attempts >= MAX_ATTEMPTS;
  await prisma.webhookDelivery.update({ where: { id: d.id }, data: { attempts, status: ok ? 'SENT' : exhausted ? 'FAILED' : 'PENDING', responseStatus: status, error, deliveredAt: ok ? new Date() : null, nextAttemptAt: ok || exhausted ? d.nextAttemptAt : new Date(Date.now() + (BACKOFF_MIN[attempts] ?? 180) * 60_000) } });
  await prisma.webhook.update({ where: { id: d.webhookId }, data: { lastDeliveryAt: new Date(), lastStatus: ok ? `OK ${status}` : `FALHA ${error}`, consecutiveFailures: ok ? 0 : { increment: 1 } } });
  await log({ key: 'WEBHOOK', provider: 'http', action: 'WEBHOOK_OUT', status: ok ? 'OK' : 'FAILED', attempt: attempts, durationMs: Date.now() - t0, request: { url: d.webhook.url, event: d.event }, response: { status }, error, referenceType: 'webhookDelivery', referenceId: d.id, idempotencyKey: `${d.webhookId}:${d.eventId}` });
}

/** Processa entregas pendentes vencidas (cron ou disparo imediato). */
export async function dispatchPending(opts: { limit?: number; budgetMs?: number } = {}): Promise<{ sent: number; failed: number; retried: number }> {
  const deadline = Date.now() + (opts.budgetMs ?? 40_000);
  const rows = await prisma.webhookDelivery.findMany({ where: { status: 'PENDING', nextAttemptAt: { lte: new Date() }, webhook: { deletedAt: null, isActive: true } }, include: { webhook: true }, orderBy: { nextAttemptAt: 'asc' }, take: opts.limit ?? 100 });
  const out = { sent: 0, failed: 0, retried: 0 };
  for (const d of rows) {
    if (Date.now() > deadline) break;
    await deliver(d);
    const after = await prisma.webhookDelivery.findUnique({ where: { id: d.id }, select: { status: true } });
    if (after?.status === 'SENT') out.sent += 1; else if (after?.status === 'FAILED') out.failed += 1; else out.retried += 1;
  }
  return out;
}

export async function deliveries(webhookId: string, page = 1, pageSize = 30): Promise<{ items: Array<{ id: string; event: string; eventId: string; status: string; attempts: number; responseStatus: number | null; error: string | null; nextAttemptAt: string; deliveredAt: string | null; createdAt: string }>; total: number }> {
  const where = { webhookId, webhook: { deletedAt: null } };
  const [rows, total] = await Promise.all([prisma.webhookDelivery.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }), prisma.webhookDelivery.count({ where })]);
  return { items: rows.map((r) => ({ id: r.id, event: r.event, eventId: r.eventId, status: r.status, attempts: r.attempts, responseStatus: r.responseStatus, error: r.error, nextAttemptAt: r.nextAttemptAt.toISOString(), deliveredAt: r.deliveredAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString() })), total };
}
export async function retry(ctx: Ctx, deliveryId: string): Promise<void> {
  const d = await prisma.webhookDelivery.findFirst({ where: { id: deliveryId, webhook: { deletedAt: null } } }); if (!d) throw notFound('Entrega não encontrada');
  await prisma.webhookDelivery.update({ where: { id: deliveryId }, data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), error: null } });
  await audit(ctx, { action: 'WEBHOOK_RETRY', resource: 'webhookDelivery', resourceId: deliveryId });
  await dispatchPending({ limit: 1, budgetMs: 10_000 });
}
export async function ping(ctx: Ctx, id: string): Promise<{ queued: boolean }> {
  const w = await prisma.webhook.findFirst({ where: { id, deletedAt: null } }); if (!w) throw notFound('Webhook não encontrado');
  const eventId = randomUUID();
  await prisma.webhookDelivery.create({ data: { webhookId: id, eventId, event: 'test.ping', payload: { id: eventId, event: 'test.ping', occurredAt: new Date().toISOString(), data: { message: 'Teste de webhook do Siow System', byUser: ctx.user.name } } as Prisma.InputJsonValue } });
  await dispatchPending({ limit: 1, budgetMs: 10_000 });
  return { queued: true };
}
