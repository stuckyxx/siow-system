/**
 * Atendimento (Fase 6): chamados/tickets com SLA por prioridade, histórico de interações
 * (notas, respostas, ligações, visitas, reuniões/atas), responsáveis, tarefas de acompanhamento,
 * anexos, satisfação (link público) e alertas de SLA no cron. Tudo aparece na ficha 360º.
 */
import { randomBytes } from 'node:crypto';
import type { Prisma } from '@siow/db';
import { INTERACTION_KIND_LABELS, TICKET_OPEN_STATUSES, TICKET_STATUS_LABELS, brDateTimeToDate, isoToDate, todayIso, type InteractionKind, type Paginated, type TicketDetail, type TicketRow, type TicketStats, type TicketStatus } from '@siow/shared';
import type { z } from 'zod';
import type { ticketAssignSchema, ticketInteractionSchema, ticketListFilterSchema, ticketRatingSchema, ticketSchema, ticketStatusSchema, ticketTaskSchema, updateTicketSchema } from '@siow/shared';
import { prisma, prismaPlatform } from '../db.js';
import { currentOrgId } from '../tenant.js';
import { audit } from '../audit.js';
import { badRequest, notFound, type Ctx } from '../http.js';
import { storeDocument, get as getDocument } from './documents.js';
import { send as sendMessage } from './messaging.js';
import { create as createTask } from './tasks.js';

type SlaTable = Record<string, { response: number; resolution: number }>;
const DEFAULT_SLA: SlaTable = { URGENT: { response: 2, resolution: 8 }, HIGH: { response: 4, resolution: 24 }, MEDIUM: { response: 8, resolution: 72 }, LOW: { response: 24, resolution: 120 } };
const AT_RISK_HOURS = 2;

export async function slaTable(): Promise<SlaTable> {
  const s = await prisma.setting.findUnique({ where: { key: 'tickets.sla' } });
  const v = (s?.value ?? null) as SlaTable | null;
  return v && typeof v === 'object' ? { ...DEFAULT_SLA, ...v } : DEFAULT_SLA;
}
function slaDue(opened: Date, priority: string, table: SlaTable): { firstResponseDueAt: Date; resolutionDueAt: Date } {
  const p = table[priority] ?? DEFAULT_SLA['MEDIUM']!;
  return { firstResponseDueAt: new Date(opened.getTime() + p.response * 3_600_000), resolutionDueAt: new Date(opened.getTime() + p.resolution * 3_600_000) };
}

const include = {
  entity: { select: { id: true, name: true, shortName: true, municipality: true, uf: true } },
  contact: { select: { id: true, name: true, phone: true, whatsapp: true, email: true } },
  assignee: { select: { id: true, name: true } },
  _count: { select: { interactions: true, tasks: { where: { deletedAt: null, status: { in: ['PENDING', 'IN_PROGRESS'] } } } } },
} satisfies Prisma.TicketInclude;
type Row = Prisma.TicketGetPayload<{ include: typeof include }>;

/** Janela de risco: 2h, ou metade do prazo quando o SLA é curto (ex.: urgente 2h → risco na última hora). */
function riskWindowMs(openedAt: Date, dueAt: Date): number { return Math.min(AT_RISK_HOURS * 3_600_000, Math.max(15 * 60_000, (dueAt.getTime() - openedAt.getTime()) / 2)); }
function slaState(openedAt: Date, dueAt: Date | null, doneAt: Date | null, now: Date, closed: boolean): TicketRow['responseSla'] {
  if (!dueAt) return 'NA';
  if (doneAt) return doneAt <= dueAt ? 'MET' : 'BREACHED';
  if (closed) return 'NA';
  if (now > dueAt) return 'BREACHED';
  return dueAt.getTime() - now.getTime() <= riskWindowMs(openedAt, dueAt) ? 'AT_RISK' : 'OK';
}
function toRow(t: Row, now: Date): TicketRow {
  const closed = !TICKET_OPEN_STATUSES.includes(t.status as TicketStatus);
  return {
    id: t.id, number: t.number, entity: t.entity, contact: t.contact, contractId: t.contractId, opportunityId: t.opportunityId, tenderId: t.tenderId,
    type: t.type, channel: t.channel, priority: t.priority, status: t.status, subject: t.subject, description: t.description, requesterName: t.requesterName,
    assignee: t.assignee, openedAt: t.openedAt.toISOString(), firstResponseDueAt: t.firstResponseDueAt?.toISOString() ?? null, resolutionDueAt: t.resolutionDueAt?.toISOString() ?? null,
    firstResponseAt: t.firstResponseAt?.toISOString() ?? null, resolvedAt: t.resolvedAt?.toISOString() ?? null, closedAt: t.closedAt?.toISOString() ?? null, lastActivityAt: t.lastActivityAt.toISOString(), resolutionNotes: t.resolutionNotes,
    satisfactionScore: t.satisfactionScore, satisfactionComment: t.satisfactionComment, satisfactionAt: t.satisfactionAt?.toISOString() ?? null,
    responseSla: slaState(t.openedAt, t.firstResponseDueAt, t.firstResponseAt, now, closed), resolutionSla: slaState(t.openedAt, t.resolutionDueAt, t.resolvedAt ?? t.closedAt, now, closed && !t.resolvedAt),
    interactionsCount: t._count.interactions, openTasks: t._count.tasks, createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString(),
  };
}

export async function list(f: z.infer<typeof ticketListFilterSchema>, userId: string): Promise<Paginated<TicketRow>> {
  const now = new Date();
  const where: Prisma.TicketWhereInput = { deletedAt: null, entityId: f.entityId, priority: f.priority, type: f.type };
  if (f.status) where.status = f.status;
  else if (f.open) where.status = { in: TICKET_OPEN_STATUSES };
  if (f.assigneeUserId === 'me') where.assigneeUserId = userId;
  else if (f.assigneeUserId === 'unassigned') where.assigneeUserId = null;
  else if (f.assigneeUserId) where.assigneeUserId = f.assigneeUserId;
  if (f.slaBreached) where.AND = [{ status: { in: TICKET_OPEN_STATUSES } }, { OR: [{ resolutionDueAt: { lt: now } }, { firstResponseAt: null, firstResponseDueAt: { lt: now } }] }];
  if (f.q) {
    const n = Number(f.q.replace(/\D/g, ''));
    where.OR = [{ subject: { contains: f.q, mode: 'insensitive' } }, { description: { contains: f.q, mode: 'insensitive' } }, { requesterName: { contains: f.q, mode: 'insensitive' } }, { entity: { name: { contains: f.q, mode: 'insensitive' } } }, ...(Number.isInteger(n) && n > 0 ? [{ number: n }] : [])];
  }
  if (f.from || f.to) where.openedAt = { gte: f.from ? isoToDate(f.from) : undefined, lte: f.to ? new Date(`${f.to}T23:59:59Z`) : undefined };
  const [rows, total] = await Promise.all([
    prisma.ticket.findMany({ where, include, orderBy: [{ lastActivityAt: 'desc' }], skip: (f.page - 1) * f.pageSize, take: f.pageSize }),
    prisma.ticket.count({ where }),
  ]);
  return { items: rows.map((t) => toRow(t, now)), total, page: f.page, pageSize: f.pageSize };
}

export async function stats(userId: string): Promise<TicketStats> {
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const open = await prisma.ticket.findMany({ where: { deletedAt: null, status: { in: TICKET_OPEN_STATUSES } }, select: { status: true, assigneeUserId: true, type: true, openedAt: true, firstResponseDueAt: true, firstResponseAt: true, resolutionDueAt: true, assignee: { select: { name: true } } } });
  const resolved = await prisma.ticket.findMany({ where: { deletedAt: null, resolvedAt: { gte: since } }, select: { openedAt: true, firstResponseAt: true, resolvedAt: true, satisfactionScore: true } });
  const breachedOf = (t: (typeof open)[number]) => (t.resolutionDueAt && t.resolutionDueAt < now) || (!t.firstResponseAt && t.firstResponseDueAt && t.firstResponseDueAt < now);
  const riskOf = (t: (typeof open)[number]) => !breachedOf(t) && ((t.resolutionDueAt && t.resolutionDueAt.getTime() - now.getTime() <= riskWindowMs(t.openedAt, t.resolutionDueAt)) || (!t.firstResponseAt && t.firstResponseDueAt && t.firstResponseDueAt.getTime() - now.getTime() <= riskWindowMs(t.openedAt, t.firstResponseDueAt)));
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
  const byType = new Map<string, number>(); const byAssignee = new Map<string, { userId: string | null; name: string; count: number }>();
  for (const t of open) {
    byType.set(t.type, (byType.get(t.type) ?? 0) + 1);
    const k = t.assigneeUserId ?? ''; const cur = byAssignee.get(k) ?? { userId: t.assigneeUserId, name: t.assignee?.name ?? 'Sem responsável', count: 0 }; cur.count += 1; byAssignee.set(k, cur);
  }
  const rated = resolved.filter((r) => r.satisfactionScore != null);
  return {
    open: open.filter((t) => t.status === 'OPEN').length, inProgress: open.filter((t) => t.status === 'IN_PROGRESS').length, waiting: open.filter((t) => t.status.startsWith('WAITING')).length,
    unassigned: open.filter((t) => !t.assigneeUserId).length, breached: open.filter(breachedOf).length, atRisk: open.filter(riskOf).length, mine: open.filter((t) => t.assigneeUserId === userId).length,
    resolved30d: resolved.length,
    avgFirstResponseHours: avg(resolved.filter((r) => r.firstResponseAt).map((r) => (r.firstResponseAt!.getTime() - r.openedAt.getTime()) / 3_600_000)),
    avgResolutionHours: avg(resolved.map((r) => (r.resolvedAt!.getTime() - r.openedAt.getTime()) / 3_600_000)),
    satisfactionAvg: avg(rated.map((r) => r.satisfactionScore!)), satisfactionCount: rated.length,
    byType: [...byType.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
    byAssignee: [...byAssignee.values()].sort((a, b) => b.count - a.count),
  };
}

export async function get(id: string, baseUrl?: string): Promise<TicketDetail> {
  const t = await prisma.ticket.findFirst({ where: { id, deletedAt: null }, include: { ...include, interactions: { orderBy: { occurredAt: 'desc' }, include: { user: { select: { name: true } }, contact: { select: { name: true } } } }, tasks: { where: { deletedAt: null }, orderBy: { dueDate: 'asc' }, include: { assignee: { select: { name: true } } } } } });
  if (!t) throw notFound('Chamado não encontrado');
  return {
    ...toRow(t, new Date()),
    interactions: t.interactions.map((i) => ({ id: i.id, kind: i.kind, direction: i.direction, body: i.body, occurredAt: i.occurredAt.toISOString(), durationMinutes: i.durationMinutes, location: i.location, attendees: i.attendees, userName: i.user?.name ?? null, contactName: i.contact?.name ?? null, documentId: i.documentId, outboundMessageId: i.outboundMessageId, createdAt: i.createdAt.toISOString() })),
    tasks: t.tasks.map((k) => ({ id: k.id, title: k.title, status: k.status, dueDate: k.dueDate.toISOString().slice(0, 10), assigneeName: k.assignee?.name ?? null })),
    satisfactionUrl: t.satisfactionToken && baseUrl ? `${baseUrl}/avaliacao/${t.satisfactionToken}` : null,
  };
}

async function nextNumber(): Promise<number> {
  const last = await prisma.ticket.findFirst({ where: {}, orderBy: { number: 'desc' }, select: { number: true } });
  return (last?.number ?? 0) + 1;
}
async function touch(ticketId: string, data: Prisma.TicketUpdateInput = {}): Promise<void> { await prisma.ticket.update({ where: { id: ticketId }, data: { ...data, lastActivityAt: new Date() } }); }
async function sysEvent(ticketId: string, userId: string | null, kind: InteractionKind, body: string): Promise<void> { await prisma.ticketInteraction.create({ data: { ticketId, userId, kind, direction: 'INTERNAL', body } }); }

export async function create(ctx: Ctx, input: z.infer<typeof ticketSchema>): Promise<TicketRow> {
  if (input.entityId) { const e = await prisma.entity.findFirst({ where: { id: input.entityId, deletedAt: null }, select: { id: true } }); if (!e) throw notFound('Entidade não encontrada'); }
  if (input.contactId) { const c = await prisma.contact.findFirst({ where: { id: input.contactId, deletedAt: null, entityId: input.entityId ?? undefined }, select: { id: true } }); if (!c) throw badRequest('Contato não pertence à entidade informada'); }
  const opened = input.openedAt ? brDateTimeToDate(input.openedAt) : new Date();
  const due = slaDue(opened, input.priority, await slaTable());
  // número sequencial por organização; em caso de corrida, tenta de novo
  let t: Row | null = null;
  for (let attempt = 0; attempt < 3 && !t; attempt += 1) {
    const number = (await nextNumber()) + attempt;
    try {
      t = await prisma.ticket.create({ data: { organizationId: currentOrgId(), number, entityId: input.entityId ?? null, contactId: input.contactId ?? null, contractId: input.contractId ?? null, opportunityId: input.opportunityId ?? null, tenderId: input.tenderId ?? null, type: input.type, channel: input.channel, priority: input.priority, subject: input.subject, description: input.description ?? null, requesterName: input.requesterName ?? null, assigneeUserId: input.assigneeUserId ?? null, createdByUserId: ctx.user.id, openedAt: opened, lastActivityAt: opened, ...due, status: input.assigneeUserId ? 'IN_PROGRESS' : 'OPEN', interactions: { create: { userId: ctx.user.id, kind: 'SYSTEM', direction: 'INTERNAL', body: `Chamado aberto${input.assigneeUserId ? ' e atribuído' : ''}` } } }, include });
    } catch (e) { if (!(e instanceof Error && 'code' in e && (e as { code?: string }).code === 'P2002') || attempt === 2) throw e; }
  }
  await audit(ctx, { action: 'CREATE', resource: 'ticket', resourceId: t!.id, after: { number: t!.number, subject: t!.subject, entityId: t!.entityId, priority: t!.priority } });
  return toRow(t!, new Date());
}

export async function update(ctx: Ctx, id: string, input: z.infer<typeof updateTicketSchema>): Promise<TicketRow> {
  const before = await prisma.ticket.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw notFound('Chamado não encontrado');
  const data: Prisma.TicketUncheckedUpdateInput = { ...input, openedAt: input.openedAt ? brDateTimeToDate(input.openedAt) : undefined, lastActivityAt: new Date() };
  if (input.priority && input.priority !== before.priority) { Object.assign(data, slaDue(before.openedAt, input.priority, await slaTable())); await sysEvent(id, ctx.user.id, 'SYSTEM', `Prioridade: ${before.priority} → ${input.priority} (SLA recalculado)`); }
  if (input.assigneeUserId !== undefined && input.assigneeUserId !== before.assigneeUserId) await sysEvent(id, ctx.user.id, 'ASSIGNMENT', input.assigneeUserId ? 'Responsável alterado' : 'Responsável removido');
  const t = await prisma.ticket.update({ where: { id }, data, include });
  await audit(ctx, { action: 'UPDATE', resource: 'ticket', resourceId: id, before: { subject: before.subject, priority: before.priority, assigneeUserId: before.assigneeUserId }, after: { subject: t.subject, priority: t.priority, assigneeUserId: t.assigneeUserId } });
  return toRow(t, new Date());
}

export async function assign(ctx: Ctx, id: string, input: z.infer<typeof ticketAssignSchema>): Promise<TicketRow> {
  const before = await prisma.ticket.findFirst({ where: { id, deletedAt: null }, select: { assigneeUserId: true, status: true } });
  if (!before) throw notFound('Chamado não encontrado');
  const user = input.assigneeUserId ? await prisma.user.findFirst({ where: { id: input.assigneeUserId, isActive: true }, select: { name: true } }) : null;
  if (input.assigneeUserId && !user) throw badRequest('Usuário inválido');
  const t = await prisma.ticket.update({ where: { id }, data: { assigneeUserId: input.assigneeUserId, status: before.status === 'OPEN' && input.assigneeUserId ? 'IN_PROGRESS' : before.status, lastActivityAt: new Date() }, include });
  await prisma.ticketInteraction.create({ data: { ticketId: id, userId: ctx.user.id, kind: 'ASSIGNMENT', direction: 'INTERNAL', body: user ? `Atribuído a ${user.name}${input.notes ? ` — ${input.notes}` : ''}` : 'Responsável removido' } });
  await audit(ctx, { action: 'UPDATE', resource: 'ticket', resourceId: id, before: { assigneeUserId: before.assigneeUserId }, after: { assigneeUserId: input.assigneeUserId } });
  return toRow(t, new Date());
}

export async function setStatus(ctx: Ctx, id: string, input: z.infer<typeof ticketStatusSchema>): Promise<TicketRow> {
  const before = await prisma.ticket.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw notFound('Chamado não encontrado');
  if (before.status === input.status) return toRow((await prisma.ticket.findUniqueOrThrow({ where: { id }, include })), new Date());
  const now = new Date();
  const data: Prisma.TicketUncheckedUpdateInput = { status: input.status, lastActivityAt: now };
  if (input.status === 'RESOLVED') { data.resolvedAt = before.resolvedAt ?? now; data.resolutionNotes = input.resolutionNotes ?? before.resolutionNotes; if (!before.satisfactionToken) data.satisfactionToken = randomBytes(18).toString('base64url'); }
  if (input.status === 'CLOSED') { data.closedAt = now; data.resolvedAt = before.resolvedAt ?? now; data.resolutionNotes = input.resolutionNotes ?? before.resolutionNotes; }
  if (input.status === 'CANCELLED') data.closedAt = now;
  if (TICKET_OPEN_STATUSES.includes(input.status) && !TICKET_OPEN_STATUSES.includes(before.status as TicketStatus)) { data.resolvedAt = null; data.closedAt = null; }
  const t = await prisma.ticket.update({ where: { id }, data, include });
  await prisma.ticketInteraction.create({ data: { ticketId: id, userId: ctx.user.id, kind: 'STATUS', direction: 'INTERNAL', body: `${TICKET_STATUS_LABELS[before.status as TicketStatus] ?? before.status} → ${TICKET_STATUS_LABELS[input.status]}${input.notes ? ` — ${input.notes}` : ''}${input.resolutionNotes ? ` · Solução: ${input.resolutionNotes}` : ''}` } });
  await audit(ctx, { action: 'UPDATE', resource: 'ticket', resourceId: id, before: { status: before.status }, after: { status: input.status }, justification: input.notes ?? input.resolutionNotes ?? undefined });
  return toRow(t, new Date());
}

export async function softDelete(ctx: Ctx, id: string): Promise<void> {
  const before = await prisma.ticket.findFirst({ where: { id, deletedAt: null }, select: { number: true, subject: true } });
  if (!before) throw notFound('Chamado não encontrado');
  await prisma.ticket.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit(ctx, { action: 'SOFT_DELETE', resource: 'ticket', resourceId: id, before });
}

// ---------------- interações ----------------
export async function addInteraction(ctx: Ctx, ticketId: string, input: z.infer<typeof ticketInteractionSchema>): Promise<{ interaction: TicketDetail['interactions'][number]; manualLink: string | null; sent: boolean | null }> {
  const t = await prisma.ticket.findFirst({ where: { id: ticketId, deletedAt: null }, include: { contact: true } });
  if (!t) throw notFound('Chamado não encontrado');
  const direction = input.direction ?? (input.kind === 'REPLY' || input.sendVia ? 'OUTBOUND' : input.kind === 'NOTE' ? 'INTERNAL' : 'INBOUND');
  const occurredAt = input.occurredAt ? brDateTimeToDate(input.occurredAt) : new Date();
  const contactId = input.contactId ?? t.contactId;
  let outboundMessageId: string | null = null; let manualLink: string | null = null; let sent: boolean | null = null;
  if (input.sendVia) {
    if (!t.entityId || !contactId) throw badRequest('Para enviar ao cliente, o chamado precisa de entidade e contato');
    const r = await sendMessage(ctx, { channel: input.sendVia, entityId: t.entityId, contactId, ticketId, subject: input.subject ?? `Chamado #${t.number}: ${t.subject}`, body: input.body });
    outboundMessageId = r.message.id; manualLink = r.manualLink; sent = r.sent;
  }
  const i = await prisma.ticketInteraction.create({ data: { ticketId, userId: ctx.user.id, contactId, kind: input.sendVia ? input.sendVia : input.kind, direction, body: input.body, occurredAt, durationMinutes: input.durationMinutes ?? null, location: input.location ?? null, attendees: input.attendees ?? null, outboundMessageId }, include: { user: { select: { name: true } }, contact: { select: { name: true } } } });
  const data: Prisma.TicketUpdateInput = {};
  if (direction === 'OUTBOUND' && !t.firstResponseAt) data.firstResponseAt = occurredAt;
  if (t.status === 'OPEN' && direction !== 'INBOUND') data.status = 'IN_PROGRESS';
  if (direction === 'OUTBOUND' && t.status === 'WAITING_INTERNAL') data.status = 'IN_PROGRESS';
  if (direction === 'INBOUND' && t.status === 'WAITING_CLIENT') data.status = 'IN_PROGRESS';
  await touch(ticketId, data);
  await audit(ctx, { action: 'TICKET_INTERACTION', resource: 'ticket', resourceId: ticketId, after: { kind: i.kind, direction, sent } });
  return { interaction: { id: i.id, kind: i.kind, direction: i.direction, body: i.body, occurredAt: i.occurredAt.toISOString(), durationMinutes: i.durationMinutes, location: i.location, attendees: i.attendees, userName: i.user?.name ?? null, contactName: i.contact?.name ?? null, documentId: i.documentId, outboundMessageId: i.outboundMessageId, createdAt: i.createdAt.toISOString() }, manualLink, sent };
}

export async function addDocument(ctx: Ctx, ticketId: string, file: File, name?: string) {
  const t = await prisma.ticket.findFirst({ where: { id: ticketId, deletedAt: null }, select: { id: true, number: true, entityId: true } });
  if (!t) throw notFound('Chamado não encontrado');
  if (file.size > 25 * 1024 * 1024) throw badRequest('Arquivo excede 25 MB');
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!buffer.length) throw badRequest('Arquivo vazio');
  const r = await storeDocument({ buffer, mimeType: file.type || 'application/octet-stream', name: name ?? file.name ?? `Chamado #${t.number}`, type: 'TICKET', entityId: t.entityId, ticketId, uploadedByUserId: ctx.user.id, origin: 'MANUAL' });
  await prisma.ticketInteraction.create({ data: { ticketId, userId: ctx.user.id, kind: 'SYSTEM', direction: 'INTERNAL', body: `Anexo: ${name ?? file.name}`, documentId: r.documentId } });
  await touch(ticketId);
  await audit(ctx, { action: 'DOCUMENT_UPLOADED', resource: 'ticket', resourceId: ticketId, after: { documentId: r.documentId, size: buffer.length } });
  return getDocument(r.documentId);
}

export async function addTask(ctx: Ctx, ticketId: string, input: z.infer<typeof ticketTaskSchema>) {
  const t = await prisma.ticket.findFirst({ where: { id: ticketId, deletedAt: null }, select: { id: true, number: true, entityId: true, contractId: true, opportunityId: true, tenderId: true, assigneeUserId: true } });
  if (!t) throw notFound('Chamado não encontrado');
  const task = await createTask(ctx, { title: input.title, description: `Acompanhamento do chamado #${t.number}`, type: input.type, entityId: t.entityId, contractId: t.contractId, opportunityId: t.opportunityId, tenderId: t.tenderId, ticketId, module: 'ATENDIMENTO', assigneeUserId: input.assigneeUserId ?? t.assigneeUserId, priority: input.priority, dueDate: input.dueDate, dueTime: input.dueTime ?? null, notes: input.notes ?? null, invoiceId: null, serviceOrderId: null });
  await prisma.ticketInteraction.create({ data: { ticketId, userId: ctx.user.id, kind: 'SYSTEM', direction: 'INTERNAL', body: `Tarefa de acompanhamento: ${input.title} (vence ${input.dueDate.split('-').reverse().join('/')})` } });
  await touch(ticketId);
  return task;
}

// ---------------- satisfação (público, por token) ----------------
export async function ratingInfo(token: string): Promise<{ number: number; subject: string; organization: string; rated: boolean; resolvedAt: string | null }> {
  const t = await prismaPlatform.ticket.findFirst({ where: { satisfactionToken: token, deletedAt: null }, select: { number: true, subject: true, satisfactionScore: true, resolvedAt: true, organization: { select: { name: true } } } });
  if (!t) throw notFound('Avaliação não encontrada ou expirada');
  return { number: t.number, subject: t.subject, organization: t.organization.name, rated: t.satisfactionScore != null, resolvedAt: t.resolvedAt?.toISOString() ?? null };
}
export async function rate(token: string, input: z.infer<typeof ticketRatingSchema>): Promise<{ ok: true }> {
  const t = await prismaPlatform.ticket.findFirst({ where: { satisfactionToken: token, deletedAt: null }, select: { id: true, satisfactionScore: true } });
  if (!t) throw notFound('Avaliação não encontrada ou expirada');
  if (t.satisfactionScore != null) throw badRequest('Este chamado já foi avaliado');
  await prismaPlatform.ticket.update({ where: { id: t.id }, data: { satisfactionScore: input.score, satisfactionComment: input.comment ?? null, satisfactionAt: new Date(), lastActivityAt: new Date() } });
  await prismaPlatform.ticketInteraction.create({ data: { ticketId: t.id, kind: 'SYSTEM', direction: 'INBOUND', body: `Avaliação do cliente: ${input.score}/5${input.comment ? ` — ${input.comment}` : ''}` } });
  return { ok: true };
}

// ---------------- cron: SLA ----------------
/** Notifica (dedupe por chamado+dia+tipo) chamados com SLA estourado ou a estourar em ≤ 2h; 1ª resposta e resolução. */
export async function notifySla(today = todayIso()): Promise<{ breached: number; atRisk: number }> {
  const now = new Date(); const soon = new Date(now.getTime() + AT_RISK_HOURS * 3_600_000);
  const rows = await prisma.ticket.findMany({ where: { deletedAt: null, status: { in: TICKET_OPEN_STATUSES }, OR: [{ resolutionDueAt: { lte: soon } }, { firstResponseAt: null, firstResponseDueAt: { lte: soon } }] }, select: { id: true, number: true, subject: true, entityId: true, assigneeUserId: true, firstResponseAt: true, firstResponseDueAt: true, resolutionDueAt: true } });
  let breached = 0, atRisk = 0;
  for (const t of rows) {
    const respBreached = !t.firstResponseAt && t.firstResponseDueAt && t.firstResponseDueAt < now;
    const resBreached = t.resolutionDueAt && t.resolutionDueAt < now;
    const isBreached = Boolean(respBreached || resBreached);
    const kind = isBreached ? 'BREACHED' : 'AT_RISK';
    const what = respBreached || (!t.firstResponseAt && t.firstResponseDueAt && t.firstResponseDueAt <= soon) ? 'primeira resposta' : 'resolução';
    const dedupeKey = `TICKET_SLA:${t.id}:${kind}:${today}`;
    const exists = await prisma.notification.findUnique({ where: { dedupeKey }, select: { id: true } });
    if (exists) continue;
    await prisma.notification.create({ data: { organizationId: currentOrgId(), userId: t.assigneeUserId, type: 'TICKET_SLA', title: isBreached ? `SLA estourado — chamado #${t.number}` : `SLA em risco — chamado #${t.number}`, body: `${t.subject} · ${what}${isBreached ? ' fora do prazo' : ' vence em menos de 2h'}`, entityId: t.entityId, referenceType: 'ticket', referenceId: t.id, dedupeKey } });
    if (isBreached) breached += 1; else atRisk += 1;
  }
  return { breached, atRisk };
}

export const interactionLabel = (kind: string): string => INTERACTION_KIND_LABELS[kind as InteractionKind] ?? kind;
