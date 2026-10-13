/**
 * Central de atendimento WhatsApp (Fase 6b): conversas por número (caixa de entrada), ingestão de mensagens e
 * mídias recebidas, fila com distribuição automática entre atendentes, envio de texto (janela de 24h) e de
 * modelos aprovados pela Meta (fora da janela), ligação com contato/entidade e chamado do Atendimento.
 * Todo envio passa pelo adapter com log e circuito; nada é marcado como enviado sem confirmação da Meta.
 */
import type { Prisma } from '@siow/db';
import { prisma } from '../db.js';
import { currentOrgId } from '../tenant.js';
import { audit } from '../audit.js';
import { badRequest, notFound, type Ctx } from '../http.js';
import { call, resolve } from './integrations.js';
import { storeDocument } from './documents.js';
import { adapterFor } from '../messaging/adapters.js';

const WINDOW_MS = 24 * 3_600_000;
const digits = (v: string): string => v.replace(/\D/g, '');

export interface ConversationRow {
  id: string; waId: string; displayName: string | null; contact: { id: string; name: string } | null; entity: { id: string; name: string; shortName: string | null } | null;
  ticketId: string | null; ticketNumber: number | null; status: string; assignee: { id: string; name: string } | null; unreadCount: number;
  lastInboundAt: string | null; lastOutboundAt: string | null; lastMessageAt: string; lastMessagePreview: string | null; windowOpen: boolean; windowExpiresAt: string | null;
}
export interface MessageRow { id: string; direction: string; type: string; body: string | null; mediaMimeType: string | null; mediaFileName: string | null; documentId: string | null; status: string; error: string | null; userName: string | null; templateName: string | null; timestamp: string }
export interface ConversationDetail extends ConversationRow { messages: MessageRow[] }
export interface WaTemplate { name: string; language: string; status: string; category: string; body: string; paramCount: number }

const include = { contact: { select: { id: true, name: true } }, entity: { select: { id: true, name: true, shortName: true } }, assignee: { select: { id: true, name: true } }, ticket: { select: { number: true } } } satisfies Prisma.WaConversationInclude;
type Row = Prisma.WaConversationGetPayload<{ include: typeof include }>;
function toRow(c: Row): ConversationRow {
  const exp = c.lastInboundAt ? new Date(c.lastInboundAt.getTime() + WINDOW_MS) : null;
  return { id: c.id, waId: c.waId, displayName: c.displayName, contact: c.contact, entity: c.entity, ticketId: c.ticketId, ticketNumber: c.ticket?.number ?? null, status: c.status, assignee: c.assignee, unreadCount: c.unreadCount, lastInboundAt: c.lastInboundAt?.toISOString() ?? null, lastOutboundAt: c.lastOutboundAt?.toISOString() ?? null, lastMessageAt: c.lastMessageAt.toISOString(), lastMessagePreview: c.lastMessagePreview, windowOpen: Boolean(exp && exp > new Date()), windowExpiresAt: exp?.toISOString() ?? null };
}

export async function list(f: { filter?: 'all' | 'mine' | 'unassigned' | 'unread' | 'closed'; q?: string }, userId: string): Promise<ConversationRow[]> {
  const where: Prisma.WaConversationWhereInput = { status: f.filter === 'closed' ? 'CLOSED' : 'OPEN' };
  if (f.filter === 'mine') where.assigneeUserId = userId;
  if (f.filter === 'unassigned') where.assigneeUserId = null;
  if (f.filter === 'unread') where.unreadCount = { gt: 0 };
  if (f.q) where.OR = [{ waId: { contains: digits(f.q) || '∅' } }, { displayName: { contains: f.q, mode: 'insensitive' } }, { contact: { name: { contains: f.q, mode: 'insensitive' } } }, { entity: { name: { contains: f.q, mode: 'insensitive' } } }];
  const rows = await prisma.waConversation.findMany({ where, include, orderBy: { lastMessageAt: 'desc' }, take: 200 });
  return rows.map(toRow);
}
export async function stats(userId: string): Promise<{ open: number; unassigned: number; mine: number; unread: number; waitingReply: number }> {
  const open = await prisma.waConversation.findMany({ where: { status: 'OPEN' }, select: { assigneeUserId: true, unreadCount: true, lastInboundAt: true, lastOutboundAt: true } });
  return { open: open.length, unassigned: open.filter((c) => !c.assigneeUserId).length, mine: open.filter((c) => c.assigneeUserId === userId).length, unread: open.reduce((a, c) => a + c.unreadCount, 0), waitingReply: open.filter((c) => c.lastInboundAt && (!c.lastOutboundAt || c.lastOutboundAt < c.lastInboundAt)).length };
}
export async function get(id: string): Promise<ConversationDetail> {
  const c = await prisma.waConversation.findFirst({ where: { id }, include: { ...include, messages: { orderBy: { timestamp: 'asc' }, take: 300 } } });
  if (!c) throw notFound('Conversa não encontrada');
  const userIds = [...new Set(c.messages.map((m) => m.userId).filter(Boolean) as string[])];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  return { ...toRow(c), messages: c.messages.map((m) => ({ id: m.id, direction: m.direction, type: m.type, body: m.body, mediaMimeType: m.mediaMimeType, mediaFileName: m.mediaFileName, documentId: m.documentId, status: m.status, error: m.error, userName: m.userId ? nameOf.get(m.userId) ?? null : null, templateName: m.templateName, timestamp: m.timestamp.toISOString() })) };
}
export async function markRead(id: string): Promise<void> { await prisma.waConversation.updateMany({ where: { id }, data: { unreadCount: 0 } }); }

// ---------------- fila / atribuição ----------------
async function pickAgent(): Promise<string | null> {
  const [auto, max] = await Promise.all([prisma.setting.findFirst({ where: { key: 'whatsapp.autoAssign' } }), prisma.setting.findFirst({ where: { key: 'whatsapp.maxPerAgent' } })]);
  if (auto && auto.value === false) return null;
  const limit = Number(max?.value ?? 8);
  const agents = await prisma.user.findMany({ where: { deletedAt: null, isActive: true, OR: [{ roles: { some: { role: { permissions: { some: { permission: { code: 'tickets.write' } } } } } } }, { userPermissions: { some: { permission: { code: 'tickets.write' }, granted: true } } }] }, select: { id: true } });
  if (!agents.length) return null;
  const load = await prisma.waConversation.groupBy({ by: ['assigneeUserId'], where: { status: 'OPEN', assigneeUserId: { in: agents.map((a) => a.id) } }, _count: { _all: true } });
  const count = new Map(load.map((l) => [l.assigneeUserId, l._count._all]));
  const ranked = agents.map((a) => ({ id: a.id, n: count.get(a.id) ?? 0 })).filter((a) => a.n < limit).sort((a, b) => a.n - b.n);
  return ranked[0]?.id ?? null;
}
export async function assign(ctx: Ctx, id: string, assigneeUserId: string | null): Promise<ConversationRow> {
  const c = await prisma.waConversation.update({ where: { id }, data: { assigneeUserId }, include });
  if (c.ticketId) await prisma.ticket.updateMany({ where: { id: c.ticketId, assigneeUserId: null }, data: { assigneeUserId, status: assigneeUserId ? 'IN_PROGRESS' : undefined } });
  await audit(ctx, { action: 'UPDATE', resource: 'waConversation', resourceId: id, after: { assigneeUserId } });
  return toRow(c);
}
export async function close(ctx: Ctx, id: string, resolveTicket: boolean): Promise<ConversationRow> {
  const c = await prisma.waConversation.update({ where: { id }, data: { status: 'CLOSED', closedAt: new Date(), unreadCount: 0 }, include });
  if (resolveTicket && c.ticketId) await prisma.ticket.updateMany({ where: { id: c.ticketId, status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_CLIENT', 'WAITING_INTERNAL'] } }, data: { status: 'RESOLVED', resolvedAt: new Date(), lastActivityAt: new Date(), resolutionNotes: 'Atendimento concluído pela central WhatsApp' } });
  await audit(ctx, { action: 'UPDATE', resource: 'waConversation', resourceId: id, after: { status: 'CLOSED', resolveTicket } });
  return toRow(c);
}
export async function reopen(ctx: Ctx, id: string): Promise<ConversationRow> {
  const c = await prisma.waConversation.update({ where: { id }, data: { status: 'OPEN', closedAt: null }, include });
  await audit(ctx, { action: 'UPDATE', resource: 'waConversation', resourceId: id, after: { status: 'OPEN' } });
  return toRow(c);
}
/** Liga a conversa a um contato (e à entidade dele); grava o WhatsApp no contato se estiver vazio. */
export async function linkContact(ctx: Ctx, id: string, contactId: string): Promise<ConversationRow> {
  const conv = await prisma.waConversation.findFirst({ where: { id } }); if (!conv) throw notFound('Conversa não encontrada');
  const contact = await prisma.contact.findFirst({ where: { id: contactId, deletedAt: null } }); if (!contact) throw notFound('Contato não encontrado');
  if (!contact.whatsapp) await prisma.contact.update({ where: { id: contactId }, data: { whatsapp: conv.waId } });
  const c = await prisma.waConversation.update({ where: { id }, data: { contactId, entityId: contact.entityId }, include });
  if (c.ticketId) await prisma.ticket.updateMany({ where: { id: c.ticketId }, data: { contactId, entityId: contact.entityId } });
  await audit(ctx, { action: 'UPDATE', resource: 'waConversation', resourceId: id, after: { contactId, entityId: contact.entityId } });
  return toRow(c);
}

// ---------------- ingestão (webhook) ----------------
interface InMsg { from: string; id: string; timestamp?: string; type: string; text?: { body: string }; image?: { id: string; mime_type?: string; caption?: string; filename?: string }; audio?: { id: string; mime_type?: string }; video?: { id: string; mime_type?: string; caption?: string }; document?: { id: string; mime_type?: string; filename?: string; caption?: string }; sticker?: { id: string; mime_type?: string }; location?: { latitude: number; longitude: number; name?: string; address?: string }; button?: { text: string }; interactive?: { button_reply?: { title: string }; list_reply?: { title: string } } }

/** Processa uma mensagem recebida; idempotente por id da mensagem. Devolve se abriu chamado. */
export async function ingestInbound(m: InMsg, profileName: string | null): Promise<{ conversationId: string; newTicket: boolean; duplicate: boolean }> {
  if (await prisma.waMessage.findUnique({ where: { providerMessageId: m.id }, select: { id: true } })) {
    const existing = await prisma.waConversation.findFirst({ where: { waId: digits(m.from) }, select: { id: true } });
    return { conversationId: existing?.id ?? '', newTicket: false, duplicate: true };
  }
  const org = currentOrgId(); const waId = digits(m.from); const ts = m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date();
  const media = m.image ?? m.audio ?? m.video ?? m.document ?? m.sticker ?? null;
  const caption = media && 'caption' in media ? (media as { caption?: string }).caption ?? '' : '';
  const body: string = m.type === 'text' ? (m.text?.body ?? '') : m.type === 'location' ? `📍 ${m.location?.name ?? ''} ${m.location?.address ?? ''} (${m.location?.latitude}, ${m.location?.longitude})`.trim() : (m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? caption);
  const preview: string = body || `[${({ image: 'imagem', audio: 'áudio', video: 'vídeo', document: 'documento', sticker: 'figurinha' } as Record<string, string>)[m.type] ?? m.type}]`;
  let conv = await prisma.waConversation.findFirst({ where: { waId }, include });
  const tail = waId.slice(-8);
  const contact = !conv?.contactId && tail.length >= 8 ? await prisma.contact.findFirst({ where: { deletedAt: null, OR: [{ whatsapp: { endsWith: tail } }, { phone: { endsWith: tail } }] }, select: { id: true, entityId: true, name: true } }) : null;
  const reopened = Boolean(conv && conv.status === 'CLOSED');
  if (!conv) conv = await prisma.waConversation.create({ data: { organizationId: org, waId, displayName: profileName, contactId: contact?.id ?? null, entityId: contact?.entityId ?? null, lastMessageAt: ts }, include });
  // chamado: um por conversa aberta; reabertura cria outro
  let newTicket = false;
  let ticketId = conv.ticketId;
  if (ticketId) { const t = await prisma.ticket.findFirst({ where: { id: ticketId, deletedAt: null }, select: { status: true } }); if (!t || ['RESOLVED', 'CLOSED', 'CANCELLED'].includes(t.status)) ticketId = null; }
  if (!ticketId) {
    const last = await prisma.ticket.findFirst({ where: {}, orderBy: { number: 'desc' }, select: { number: true } });
    const name = conv.contact?.name ?? contact?.name ?? profileName ?? waId;
    const t = await prisma.ticket.create({ data: { organizationId: org, number: (last?.number ?? 0) + 1, entityId: conv.entityId ?? contact?.entityId ?? null, contactId: conv.contactId ?? contact?.id ?? null, type: 'REQUEST', channel: 'WHATSAPP', priority: 'MEDIUM', subject: `WhatsApp de ${name}: ${preview.slice(0, 80)}`, description: body || null, requesterName: profileName ?? null, assigneeUserId: conv.assigneeUserId, status: conv.assigneeUserId ? 'IN_PROGRESS' : 'OPEN', interactions: { create: [{ kind: 'SYSTEM', direction: 'INTERNAL', body: 'Chamado aberto pela central WhatsApp' }] } } });
    ticketId = t.id; newTicket = true;
  }
  // mídia: baixa pela Graph API e guarda como documento (ligado à entidade/chamado)
  let documentId: string | null = null;
  let transcript: string | null = null;
  if (media?.id) {
    try {
      const file = await downloadMedia(media.id);
      const fileName: string = ('filename' in media && typeof (media as { filename?: string }).filename === 'string' && (media as { filename?: string }).filename) || `${m.type}-${m.id.slice(-8)}.${(file.mimeType.split('/')[1] ?? 'bin').split(';')[0]}`;
      const r = await storeDocument({ buffer: file.buffer, mimeType: file.mimeType, name: fileName, type: 'OTHER', entityId: conv.entityId ?? contact?.entityId ?? null, ticketId, origin: 'SYNC', metadata: { source: 'whatsapp', waMessageId: m.id } });
      documentId = r.documentId;
      // Fase 13: áudio recebido vira texto quando a integração de transcrição está configurada.
      if (m.type === 'audio' && !body) {
        try { const sp = await import('./speech.js'); if ((await sp.capabilities()).server) { const t = await sp.transcribe({ buffer: file.buffer, mimeType: file.mimeType, fileName, referenceType: 'wa_message', referenceId: m.id }); if (t.text) transcript = t.text; } }
        catch (e) { console.error('transcrição de áudio do WhatsApp falhou', e); }
      }
    } catch (e) { console.error('download de mídia do WhatsApp falhou', e); }
  }
  const text = transcript ? `🎙️ ${transcript}` : body;
  const previewText = transcript ? `🎙️ ${transcript}` : preview;
  const assignee = conv.assigneeUserId ?? (await pickAgent());
  await prisma.$transaction(async (tx) => {
    await tx.waMessage.create({ data: { conversationId: conv!.id, direction: 'IN', providerMessageId: m.id, type: m.type, body: text || null, mediaId: media?.id ?? null, mediaMimeType: media?.mime_type ?? null, mediaFileName: 'filename' in (media ?? {}) ? (media as { filename?: string }).filename ?? null : null, documentId, status: 'RECEIVED', timestamp: ts } });
    await tx.waConversation.update({ where: { id: conv!.id }, data: { status: 'OPEN', closedAt: null, ticketId, displayName: conv!.displayName ?? profileName, contactId: conv!.contactId ?? contact?.id ?? null, entityId: conv!.entityId ?? contact?.entityId ?? null, assigneeUserId: assignee, lastInboundAt: ts, lastMessageAt: ts, lastMessagePreview: previewText.slice(0, 120), unreadCount: { increment: 1 } } });
    await tx.ticketInteraction.create({ data: { ticketId: ticketId!, contactId: conv!.contactId ?? contact?.id ?? null, kind: 'WHATSAPP', direction: 'INBOUND', body: previewText, documentId, occurredAt: ts } });
    await tx.ticket.update({ where: { id: ticketId! }, data: { lastActivityAt: ts, status: newTicket ? undefined : 'IN_PROGRESS', assigneeUserId: assignee ?? undefined } });
    await tx.notification.create({ data: { organizationId: org, userId: assignee, type: 'GENERIC', title: `WhatsApp de ${conv!.displayName ?? profileName ?? waId}`, body: previewText.slice(0, 300), entityId: conv!.entityId ?? contact?.entityId ?? null, referenceType: 'waConversation', referenceId: conv!.id, dedupeKey: `WA_IN:${m.id}` } });
  });
  void reopened;
  return { conversationId: conv.id, newTicket, duplicate: false };
}
/** Atualiza status (sent/delivered/read/failed) de uma mensagem enviada. */
export async function applyStatus(providerMessageId: string, status: string, errors?: unknown): Promise<boolean> {
  const map: Record<string, string> = { sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED' };
  const st = map[status]; if (!st) return false;
  const r = await prisma.waMessage.updateMany({ where: { providerMessageId, direction: 'OUT', NOT: { status: 'READ' } }, data: { status: st, error: st === 'FAILED' ? JSON.stringify(errors ?? {}).slice(0, 500) : undefined } });
  await prisma.outboundMessage.updateMany({ where: { providerMessageId, status: { not: 'FAILED' } }, data: st === 'FAILED' ? { status: 'FAILED', errorMessage: JSON.stringify(errors ?? {}).slice(0, 500) } : st === 'DELIVERED' || st === 'READ' ? { status: 'DELIVERED' } : {} });
  return r.count > 0;
}

async function graph(): Promise<{ apiUrl: string; token: string; phoneId: string; wabaId: string | null }> {
  const cfg = await resolve('WHATSAPP');
  if (!cfg.enabled || !cfg.configured) throw badRequest('Integração WhatsApp não configurada (Administração → Integrações)');
  if (cfg.circuitOpen) throw badRequest('Integração WhatsApp com falhas seguidas: circuito aberto por 15 minutos');
  return { apiUrl: (cfg.config['apiUrl'] || 'https://graph.facebook.com/v21.0').replace(/\/+$/, ''), token: cfg.config['token']!, phoneId: cfg.config['phoneId']!, wabaId: cfg.config['wabaId'] || null };
}
async function downloadMedia(mediaId: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const g = await graph();
  return call('WHATSAPP', 'MEDIA', { request: { mediaId } }, async () => {
    const meta = await fetch(`${g.apiUrl}/${mediaId}`, { headers: { Authorization: `Bearer ${g.token}` }, cache: 'no-store' });
    const j = (await meta.json().catch(() => null)) as { url?: string; mime_type?: string } | null;
    if (!meta.ok || !j?.url) throw new Error(`Meta não devolveu a URL da mídia (${meta.status})`);
    const f = await fetch(j.url, { headers: { Authorization: `Bearer ${g.token}` }, cache: 'no-store' });
    if (!f.ok) throw new Error(`Download da mídia falhou (${f.status})`);
    return { result: { buffer: Buffer.from(await f.arrayBuffer()), mimeType: j.mime_type ?? f.headers.get('content-type') ?? 'application/octet-stream' }, response: { mime: j.mime_type } };
  });
}

// ---------------- envio ----------------
async function recordOutbound(ctx: Ctx, conv: Row, kind: 'text' | 'template', body: string, providerMessageId: string | null, accepted: boolean, error: string | null, templateName?: string): Promise<MessageRow> {
  const now = new Date();
  const msg = await prisma.waMessage.create({ data: { conversationId: conv.id, direction: 'OUT', providerMessageId, type: kind, body, status: accepted ? 'SENT' : 'FAILED', error, userId: ctx.user.id, templateName: templateName ?? null, timestamp: now } });
  await prisma.waConversation.update({ where: { id: conv.id }, data: { lastOutboundAt: accepted ? now : undefined, lastMessageAt: now, lastMessagePreview: `Você: ${body.slice(0, 100)}`, status: 'OPEN', closedAt: null } });
  if (conv.ticketId && accepted) { await prisma.ticketInteraction.create({ data: { ticketId: conv.ticketId, userId: ctx.user.id, contactId: conv.contactId, kind: 'WHATSAPP', direction: 'OUTBOUND', body: templateName ? `[modelo ${templateName}] ${body}` : body, occurredAt: now } }); const t = await prisma.ticket.findFirst({ where: { id: conv.ticketId }, select: { firstResponseAt: true, status: true } }); await prisma.ticket.update({ where: { id: conv.ticketId }, data: { lastActivityAt: now, firstResponseAt: t?.firstResponseAt ?? now, status: t?.status === 'OPEN' || t?.status === 'WAITING_INTERNAL' ? 'IN_PROGRESS' : undefined } }); }
  return { id: msg.id, direction: 'OUT', type: kind, body, mediaMimeType: null, mediaFileName: null, documentId: null, status: msg.status, error, userName: ctx.user.name, templateName: templateName ?? null, timestamp: now.toISOString() };
}

export async function sendText(ctx: Ctx, id: string, body: string): Promise<MessageRow> {
  const conv = await prisma.waConversation.findFirst({ where: { id }, include }); if (!conv) throw notFound('Conversa não encontrada');
  const row = toRow(conv);
  if (!row.windowOpen) throw badRequest('Janela de 24h fechada: o cliente não escreveu nas últimas 24 horas. Use um modelo aprovado.');
  const adapter = await adapterFor('WHATSAPP');
  if (!adapter.isConfigured()) throw badRequest('Integração WhatsApp não configurada ou com circuito aberto');
  let res; try { res = await adapter.send({ recipient: conv.waId, body, referenceType: 'waConversation', referenceId: id }); } catch (e) { return recordOutbound(ctx, conv, 'text', body, null, false, e instanceof Error ? e.message : String(e)); }
  const out = await recordOutbound(ctx, conv, 'text', body, res.providerMessageId, res.accepted, res.accepted ? null : 'Meta não confirmou o envio');
  if (!conv.assigneeUserId) await prisma.waConversation.update({ where: { id }, data: { assigneeUserId: ctx.user.id } });
  return out;
}

const tplCache = new Map<string, { at: number; value: WaTemplate[] }>();
export async function templates(force = false): Promise<WaTemplate[]> {
  const g = await graph();
  if (!g.wabaId) throw badRequest('Informe o WhatsApp Business Account ID na integração para listar os modelos aprovados');
  const k = `${currentOrgId()}:${g.wabaId}`; const hit = tplCache.get(k);
  if (!force && hit && Date.now() - hit.at < 5 * 60_000) return hit.value;
  let list: WaTemplate[];
  try { list = await call('WHATSAPP', 'TEMPLATES', { request: { wabaId: g.wabaId } }, async () => {
    const res = await fetch(`${g.apiUrl}/${g.wabaId}/message_templates?fields=name,language,status,category,components&limit=200`, { headers: { Authorization: `Bearer ${g.token}` }, cache: 'no-store' });
    const j = (await res.json().catch(() => null)) as { data?: Array<{ name: string; language: string; status: string; category: string; components?: Array<{ type: string; text?: string }> }>; error?: { message?: string } } | null;
    if (!res.ok) throw new Error(`Meta respondeu ${res.status}: ${j?.error?.message ?? ''}`);
    const out: WaTemplate[] = (j?.data ?? []).filter((t) => t.status === 'APPROVED').map((t) => { const body = t.components?.find((c) => c.type === 'BODY')?.text ?? ''; return { name: t.name, language: t.language, status: t.status, category: t.category, body, paramCount: (body.match(/\{\{\d+\}\}/g) ?? []).length }; });
    return { result: out, response: { count: out.length } };
  }); } catch (e) { throw badRequest(`Não foi possível obter os modelos na Meta: ${e instanceof Error ? e.message : String(e)}`); }
  tplCache.set(k, { at: Date.now(), value: list }); return list;
}
export async function sendTemplate(ctx: Ctx, id: string, name: string, language: string, params: string[]): Promise<MessageRow> {
  const conv = await prisma.waConversation.findFirst({ where: { id }, include }); if (!conv) throw notFound('Conversa não encontrada');
  const tpl = (await templates()).find((t) => t.name === name && t.language === language); if (!tpl) throw badRequest('Modelo não aprovado ou inexistente');
  if (params.length !== tpl.paramCount) throw badRequest(`O modelo exige ${tpl.paramCount} parâmetro(s)`);
  const rendered = tpl.body.replace(/\{\{(\d+)\}\}/g, (_m, i: string) => params[Number(i) - 1] ?? '');
  const g = await graph();
  let providerMessageId: string | null = null, accepted = false, error: string | null = null;
  try {
    await call('WHATSAPP', 'SEND_TEMPLATE', { request: { to: conv.waId, template: name }, referenceType: 'waConversation', referenceId: id }, async () => {
      const res = await fetch(`${g.apiUrl}/${g.phoneId}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${g.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to: conv.waId, type: 'template', template: { name, language: { code: language }, components: params.length ? [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: p })) }] : [] } }), cache: 'no-store' });
      const j = (await res.json().catch(() => null)) as { messages?: Array<{ id: string }>; error?: { message?: string } } | null;
      providerMessageId = j?.messages?.[0]?.id ?? null; accepted = res.ok && Boolean(providerMessageId); if (!accepted) error = j?.error?.message ?? `Meta respondeu ${res.status}`;
      return { result: null, response: { status: res.status, id: providerMessageId }, ok: accepted };
    });
  } catch (e) { error = e instanceof Error ? e.message : String(e); }
  const out = await recordOutbound(ctx, conv, 'template', rendered, providerMessageId, accepted, error, name);
  if (accepted && !conv.assigneeUserId) await prisma.waConversation.update({ where: { id }, data: { assigneeUserId: ctx.user.id } });
  return out;
}
/** Inicia conversa com um contato cadastrado (cria a conversa se não existir). */
export async function startWithContact(ctx: Ctx, contactId: string): Promise<ConversationRow> {
  const contact = await prisma.contact.findFirst({ where: { id: contactId, deletedAt: null } }); if (!contact) throw notFound('Contato não encontrado');
  let waId = digits(contact.whatsapp ?? contact.phone ?? ''); if (!waId) throw badRequest('Contato sem WhatsApp/telefone');
  if (waId.length <= 11) waId = `55${waId}`;
  const c = await prisma.waConversation.upsert({ where: { organizationId_waId: { organizationId: currentOrgId(), waId } }, create: { organizationId: currentOrgId(), waId, displayName: contact.name, contactId, entityId: contact.entityId, assigneeUserId: ctx.user.id }, update: { status: 'OPEN', closedAt: null, contactId, entityId: contact.entityId }, include });
  return toRow(c);
}
