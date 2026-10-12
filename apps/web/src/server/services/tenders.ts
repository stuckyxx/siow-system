/**
 * Licitações (módulo 3): processos, prazos, concorrentes, checklist de habilitação ligado às certidões, documentos,
 * importação do PNCP e por planilha, homologação → contrato (rascunho por padrão). Identificador oficial único por organização.
 */
import { Prisma } from '@siow/db';
import { PNCP_MODALITIES, TENDER_MODALITY_LABELS, TENDER_STATUS_LABELS, addDaysIso, dateToIso, daysBetween, isoToDate, todayIso, type PncpPublication, type Paginated, type TenderChecklistRow, type TenderDetail, type TenderModality, type TenderRow, type TenderStatus, brDateTimeToDate, formatBrDateTime } from '@siow/shared';
import type { z } from 'zod';
import type { formalizeTenderSchema, pncpImportSchema, pncpSearchSchema, tenderChecklistItemSchema, tenderCompetitorSchema, tenderDeadlineSchema, tenderListFilterSchema, tenderSchema, tenderStatusSchema, updateTenderChecklistItemSchema, updateTenderSchema } from '@siow/shared';
import { fetchComprasGov, fetchPncpPublications, type PncpRaw, type PncpSearch } from '@siow/integrations';
import { call, resolve } from './integrations.js';
import { prisma } from '../db.js';
import { currentOrgId } from '../tenant.js';
import { audit } from '../audit.js';
import { emit } from './webhooks.js';
import { badRequest, notFound, type Ctx } from '../http.js';
import { create as createContract } from './contracts.js';
import { create as createAlarm } from './alarms.js';
import { storeDocument, get as getDocument } from './documents.js';
import { parseSheets, type ImportFile } from './entities.js';

const D = (v: string | null | undefined): Prisma.Decimal | null | undefined => (v === undefined ? undefined : v ? new Prisma.Decimal(v) : null);
const dt = (v: string | null | undefined): Date | null | undefined => (v === undefined ? undefined : v ? brDateTimeToDate(v) : null);
const dd = (v: string | null | undefined): Date | null | undefined => (v === undefined ? undefined : v ? isoToDate(v) : null);
const providerCtx = () => ({ timeoutMs: Number(process.env['SYNC_HTTP_TIMEOUT_MS'] ?? 20_000), userAgent: process.env['SYNC_USER_AGENT'] ?? 'SiowSystem/1.0' });
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const include = {
  entity: { select: { id: true, name: true, shortName: true, municipality: true, uf: true } },
  owner: { select: { id: true, name: true } },
  deadlines: { orderBy: { dueAt: 'asc' as const } },
  checklist: { orderBy: { position: 'asc' as const } },
  contracts: { select: { id: true }, take: 1 },
} satisfies Prisma.TenderInclude;
type Row = Prisma.TenderGetPayload<{ include: typeof include }>;

async function certStatuses(items: Array<{ certificateId: string | null }>, refDate: string): Promise<Map<string, { name: string; validUntil: string | null; status: TenderChecklistRow['certificateStatus'] }>> {
  const ids = [...new Set(items.map((i) => i.certificateId).filter(Boolean) as string[])];
  const out = new Map<string, { name: string; validUntil: string | null; status: TenderChecklistRow['certificateStatus'] }>();
  if (!ids.length) return out;
  const certs = await prisma.certificate.findMany({ where: { id: { in: ids } }, include: { versions: { where: { isCurrent: true }, take: 1 } } });
  for (const c of certs) {
    const v = c.versions[0]?.validUntil ? dateToIso(c.versions[0].validUntil) : null;
    const status: TenderChecklistRow['certificateStatus'] = !v ? 'MISSING' : v < refDate ? 'EXPIRED' : daysBetween(refDate, v) <= 15 ? 'EXPIRING' : 'VALID';
    out.set(c.id, { name: c.name, validUntil: v, status });
  }
  return out;
}

function toRow(t: Row, now: Date): TenderRow {
  const open = t.deadlines.filter((d) => !d.done);
  const next = open.find((d) => d.dueAt >= now) ?? open[0] ?? null;
  return {
    id: t.id, entity: t.entity, opportunityId: t.opportunityId, modality: t.modality, number: t.number, year: t.year, officialId: t.officialId, object: t.object, status: t.status,
    estimatedValue: t.estimatedValue?.toFixed(2) ?? null, ourProposalValue: t.ourProposalValue?.toFixed(2) ?? null, winnerValue: t.winnerValue?.toFixed(2) ?? null,
    publishedAt: dateToIso(t.publishedAt), proposalDeadline: t.proposalDeadline?.toISOString() ?? null, sessionAt: t.sessionAt?.toISOString() ?? null, resultAt: dateToIso(t.resultAt), homologatedAt: dateToIso(t.homologatedAt),
    portalUrl: t.portalUrl, source: t.source, owner: t.owner, lossReason: t.lossReason, notes: t.notes,
    nextDeadline: next ? { title: next.title, dueAt: next.dueAt.toISOString(), overdue: next.dueAt < now } : null, openDeadlines: open.length,
    checklistDone: t.checklist.filter((c) => c.done).length, checklistTotal: t.checklist.length, checklistBlocked: 0,
    contractId: t.contracts[0]?.id ?? null, createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString(),
  };
}

export async function list(f: z.infer<typeof tenderListFilterSchema>): Promise<Paginated<TenderRow>> {
  const where: Prisma.TenderWhereInput = { deletedAt: null, entityId: f.entityId, modality: f.modality || undefined };
  if (f.status) where.status = f.status;
  else if (f.open) where.status = { in: ['IDENTIFIED', 'ANALYZING', 'PREPARING', 'SUBMITTED', 'IN_SESSION', 'WON'] };
  if (f.uf) where.entity = { uf: f.uf.toUpperCase() };
  if (f.q) where.OR = [{ number: { contains: f.q, mode: 'insensitive' } }, { object: { contains: f.q, mode: 'insensitive' } }, { officialId: { contains: f.q, mode: 'insensitive' } }, { entity: { name: { contains: f.q, mode: 'insensitive' } } }];
  if (f.from || f.to) where.sessionAt = { gte: f.from ? isoToDate(f.from) : undefined, lte: f.to ? new Date(`${f.to}T23:59:59Z`) : undefined };
  const [rows, total] = await Promise.all([
    prisma.tender.findMany({ where, include, orderBy: [{ sessionAt: 'asc' }, { createdAt: 'desc' }], skip: (f.page - 1) * f.pageSize, take: f.pageSize }),
    prisma.tender.count({ where }),
  ]);
  const now = new Date();
  return { items: rows.map((t) => toRow(t, now)), total, page: f.page, pageSize: f.pageSize };
}

/** Prazos (de todas as licitações em andamento) num intervalo — calendário. */
export async function calendar(from: string, to: string): Promise<Array<{ id: string; tenderId: string; tenderNumber: string; entityName: string; kind: string; title: string; dueAt: string; done: boolean }>> {
  const rows = await prisma.tenderDeadline.findMany({ where: { dueAt: { gte: isoToDate(from), lte: new Date(`${to}T23:59:59Z`) }, tender: { deletedAt: null } }, include: { tender: { select: { id: true, number: true, entity: { select: { name: true, shortName: true } } } } }, orderBy: { dueAt: 'asc' } });
  return rows.map((d) => ({ id: d.id, tenderId: d.tenderId, tenderNumber: d.tender.number, entityName: d.tender.entity.shortName ?? d.tender.entity.name, kind: d.kind, title: d.title, dueAt: d.dueAt.toISOString(), done: d.done }));
}

export async function get(id: string): Promise<TenderDetail> {
  const t = await prisma.tender.findFirst({ where: { id, deletedAt: null }, include: { ...include, competitors: { orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }] }, events: { orderBy: { createdAt: 'desc' }, take: 200 } } });
  if (!t) throw notFound('Licitação não encontrada');
  const now = new Date(); const today = todayIso();
  const ref = t.sessionAt ? dateToIso(t.sessionAt)! : today;
  const certs = await certStatuses(t.checklist, ref);
  const userIds = [...new Set(t.events.map((e) => e.userId).filter(Boolean) as string[])];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const checklist: TenderChecklistRow[] = t.checklist.map((c) => { const cs = c.certificateId ? certs.get(c.certificateId) : undefined; return { id: c.id, title: c.title, certificateId: c.certificateId, certificateName: cs?.name ?? null, certificateValidUntil: cs?.validUntil ?? null, certificateStatus: c.certificateId ? cs?.status ?? 'MISSING' : null, documentId: c.documentId, required: c.required, done: c.done, position: c.position, notes: c.notes }; });
  const row = toRow(t, now);
  row.checklistBlocked = checklist.filter((c) => c.required && !c.done && (c.certificateStatus === 'EXPIRED' || c.certificateStatus === 'MISSING')).length;
  return {
    ...row,
    deadlines: t.deadlines.map((d) => ({ id: d.id, kind: d.kind, title: d.title, dueAt: d.dueAt.toISOString(), done: d.done, notes: d.notes, overdue: !d.done && d.dueAt < now, daysLeft: daysBetween(today, dateToIso(d.dueAt)!) })),
    competitors: t.competitors.map((c) => ({ id: c.id, name: c.name, document: c.document, proposalValue: c.proposalValue?.toFixed(2) ?? null, rank: c.rank, isWinner: c.isWinner, notes: c.notes })),
    checklist,
    events: t.events.map((e) => ({ id: e.id, action: e.action, fromValue: e.fromValue, toValue: e.toValue, notes: e.notes, createdAt: e.createdAt.toISOString(), userName: e.userId ? nameOf.get(e.userId) ?? null : null })),
  };
}

/** Checklist padrão: uma linha por certidão ativa da empresa (entityId nulo) + itens fixos de habilitação. */
async function defaultChecklist(): Promise<Prisma.TenderChecklistItemCreateWithoutTenderInput[]> {
  const certs = await prisma.certificate.findMany({ where: { isActive: true, deletedAt: null, entityId: null }, orderBy: { name: 'asc' } });
  const items: Prisma.TenderChecklistItemCreateWithoutTenderInput[] = certs.map((c, i) => ({ title: c.name, certificateId: c.id, required: true, position: i }));
  for (const [i, title] of ['Proposta de preços assinada', 'Documentos de habilitação jurídica (contrato social, CNPJ)', 'Atestados de capacidade técnica', 'Declarações exigidas no edital'].entries()) items.push({ title, required: true, position: certs.length + i });
  return items;
}

/** Prazos padrão a partir das datas informadas. */
function defaultDeadlines(input: { proposalDeadline?: string | null; sessionAt?: string | null }): Prisma.TenderDeadlineCreateWithoutTenderInput[] {
  const out: Prisma.TenderDeadlineCreateWithoutTenderInput[] = [];
  if (input.proposalDeadline) out.push({ kind: 'PROPOSAL', title: 'Envio da proposta', dueAt: dt(input.proposalDeadline)! });
  if (input.sessionAt) out.push({ kind: 'SESSION', title: 'Sessão pública', dueAt: dt(input.sessionAt)! });
  return out;
}

export async function create(ctx: Ctx, input: z.infer<typeof tenderSchema>): Promise<TenderRow> {
  const entity = await prisma.entity.findFirst({ where: { id: input.entityId, deletedAt: null }, select: { id: true } });
  if (!entity) throw notFound('Entidade não encontrada');
  if (input.officialId) { const dup = await prisma.tender.findFirst({ where: { officialId: input.officialId, deletedAt: null }, select: { id: true, number: true } }); if (dup) throw badRequest(`Já existe a licitação ${dup.number} com o identificador oficial ${input.officialId}`); }
  const sameNumber = await prisma.tender.findFirst({ where: { entityId: input.entityId, number: input.number, year: input.year ?? null, modality: input.modality, deletedAt: null }, select: { id: true } });
  if (sameNumber) throw badRequest(`Já existe a licitação ${input.number}${input.year ? `/${input.year}` : ''} desta entidade nessa modalidade`);
  const t = await prisma.tender.create({
    data: {
      organizationId: currentOrgId(), entityId: input.entityId, opportunityId: input.opportunityId ?? null, modality: input.modality, number: input.number, year: input.year ?? null, officialId: input.officialId || null, object: input.object,
      estimatedValue: D(input.estimatedValue) ?? null, ourProposalValue: D(input.ourProposalValue) ?? null, publishedAt: dd(input.publishedAt) ?? null, proposalDeadline: dt(input.proposalDeadline) ?? null, sessionAt: dt(input.sessionAt) ?? null,
      portalUrl: input.portalUrl || null, ownerUserId: input.ownerUserId ?? ctx.user.id, notes: input.notes ?? null, createdByUserId: ctx.user.id,
      deadlines: { create: defaultDeadlines(input) }, checklist: { create: await defaultChecklist() }, events: { create: { userId: ctx.user.id, action: 'CREATED', toValue: TENDER_STATUS_LABELS.IDENTIFIED } },
    },
    include,
  });
  await audit(ctx, { action: 'CREATE', resource: 'tender', resourceId: t.id, after: { number: t.number, entityId: t.entityId, modality: t.modality, officialId: t.officialId } });
  return toRow(t, new Date());
}

export async function update(ctx: Ctx, id: string, input: z.infer<typeof updateTenderSchema>): Promise<TenderRow> {
  const before = await prisma.tender.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw notFound('Licitação não encontrada');
  if (input.officialId && input.officialId !== before.officialId) { const dup = await prisma.tender.findFirst({ where: { officialId: input.officialId, deletedAt: null, id: { not: id } } }); if (dup) throw badRequest('Identificador oficial já usado em outra licitação'); }
  const t = await prisma.tender.update({
    where: { id },
    data: { opportunityId: input.opportunityId, modality: input.modality, number: input.number, year: input.year, officialId: input.officialId === undefined ? undefined : input.officialId || null, object: input.object, estimatedValue: D(input.estimatedValue), ourProposalValue: D(input.ourProposalValue), publishedAt: dd(input.publishedAt), proposalDeadline: dt(input.proposalDeadline), sessionAt: dt(input.sessionAt), portalUrl: input.portalUrl === undefined ? undefined : input.portalUrl || null, ownerUserId: input.ownerUserId, notes: input.notes },
    include,
  });
  // sessão/proposta alteradas: atualiza os prazos padrão correspondentes ainda não concluídos
  if (input.sessionAt && t.sessionAt) await prisma.tenderDeadline.updateMany({ where: { tenderId: id, kind: 'SESSION', done: false }, data: { dueAt: t.sessionAt } });
  if (input.proposalDeadline && t.proposalDeadline) await prisma.tenderDeadline.updateMany({ where: { tenderId: id, kind: 'PROPOSAL', done: false }, data: { dueAt: t.proposalDeadline } });
  await audit(ctx, { action: 'UPDATE', resource: 'tender', resourceId: id, before: { number: before.number, sessionAt: before.sessionAt, estimatedValue: before.estimatedValue }, after: { number: t.number, sessionAt: t.sessionAt, estimatedValue: t.estimatedValue } });
  return toRow(t, new Date());
}

/** Mudança de situação com histórico. WON/HOMOLOGATED com oportunidade ligada marcam a oportunidade como ganha; LOST/CANCELLED/DESERTED como perdida. */
export async function setStatus(ctx: Ctx, id: string, input: z.infer<typeof tenderStatusSchema>): Promise<TenderRow> {
  const before = await prisma.tender.findFirst({ where: { id, deletedAt: null }, include: { contracts: { select: { id: true } } } });
  if (!before) throw notFound('Licitação não encontrada');
  if (before.status === 'HOMOLOGATED' && before.contracts.length && input.status !== 'HOMOLOGATED') throw badRequest('Licitação já formalizada em contrato: a situação não pode ser alterada');
  const t = await prisma.tender.update({
    where: { id },
    data: { status: input.status, lossReason: input.status === 'LOST' ? input.lossReason ?? null : before.lossReason, winnerValue: D(input.winnerValue), ourProposalValue: D(input.ourProposalValue), resultAt: input.resultAt ? isoToDate(input.resultAt) : ['WON', 'LOST', 'DESERTED'].includes(input.status) && !before.resultAt ? isoToDate(todayIso()) : undefined, homologatedAt: input.homologatedAt ? isoToDate(input.homologatedAt) : input.status === 'HOMOLOGATED' && !before.homologatedAt ? isoToDate(todayIso()) : undefined, events: { create: { userId: ctx.user.id, action: 'STATUS_CHANGED', fromValue: TENDER_STATUS_LABELS[before.status as TenderStatus] ?? before.status, toValue: TENDER_STATUS_LABELS[input.status], notes: input.notes ?? input.lossReason ?? null } } },
    include,
  });
  if (before.opportunityId) {
    const opp = await prisma.opportunity.findFirst({ where: { id: before.opportunityId, deletedAt: null, status: 'OPEN' }, include: { pipeline: { include: { stages: true } } } });
    const kind = input.status === 'WON' || input.status === 'HOMOLOGATED' ? 'WON' : ['LOST', 'CANCELLED', 'DESERTED', 'NOT_PARTICIPATING'].includes(input.status) ? 'LOST' : null;
    if (opp && kind) { const stage = opp.pipeline.stages.find((s) => s.kind === kind); if (stage) await prisma.opportunity.update({ where: { id: opp.id }, data: kind === 'WON' ? { status: 'WON', stageId: stage.id, stageEnteredAt: new Date(), wonAt: new Date(), lastActivityAt: new Date(), events: { create: { userId: ctx.user.id, action: 'WON', toValue: `Licitação ${before.number} ${TENDER_STATUS_LABELS[input.status].toLowerCase()}` } } } : { status: 'LOST', stageId: stage.id, stageEnteredAt: new Date(), lostAt: new Date(), lostReason: 'Licitação perdida', lostNotes: input.lossReason ?? null, lastActivityAt: new Date(), events: { create: { userId: ctx.user.id, action: 'LOST', toValue: `Licitação ${before.number}: ${TENDER_STATUS_LABELS[input.status]}` } } } }); }
  }
  await audit(ctx, { action: 'UPDATE', resource: 'tender', resourceId: id, before: { status: before.status }, after: { status: input.status }, justification: input.notes ?? input.lossReason ?? undefined });
  await emit('tender.status_changed', { tenderId: id, number: t.number, year: t.year, entityId: t.entityId, from: before.status, to: input.status });
  return toRow(t, new Date());
}

export async function softDelete(ctx: Ctx, id: string): Promise<void> {
  const before = await prisma.tender.findFirst({ where: { id, deletedAt: null }, include: { contracts: { select: { id: true } } } });
  if (!before) throw notFound('Licitação não encontrada');
  if (before.contracts.length) throw badRequest('Licitação com contrato formalizado não pode ser excluída');
  // libera o identificador oficial (único por organização) para reimportação; o valor original fica na auditoria
  await prisma.tender.update({ where: { id }, data: { deletedAt: new Date(), officialId: before.officialId ? `${before.officialId}~excluida~${Date.now()}` : null } });
  await audit(ctx, { action: 'SOFT_DELETE', resource: 'tender', resourceId: id, before: { number: before.number, entityId: before.entityId, officialId: before.officialId } });
}

// ---------------- prazos ----------------
export async function addDeadline(ctx: Ctx, tenderId: string, input: z.infer<typeof tenderDeadlineSchema>) {
  await get(tenderId);
  const d = await prisma.tenderDeadline.create({ data: { tenderId, kind: input.kind, title: input.title, dueAt: dt(input.dueAt)!, done: input.done ?? false, notes: input.notes ?? null } });
  await prisma.tenderEvent.create({ data: { tenderId, userId: ctx.user.id, action: 'DEADLINE_ADDED', toValue: `${input.title} · ${formatBrDateTime(d.dueAt)}` } });
  return d;
}
export async function updateDeadline(ctx: Ctx, tenderId: string, id: string, input: Partial<z.infer<typeof tenderDeadlineSchema>>) {
  const before = await prisma.tenderDeadline.findFirst({ where: { id, tenderId } });
  if (!before) throw notFound('Prazo não encontrado');
  const d = await prisma.tenderDeadline.update({ where: { id }, data: { kind: input.kind, title: input.title, dueAt: dt(input.dueAt) ?? undefined, done: input.done, notes: input.notes } });
  if (input.done !== undefined && input.done !== before.done) await prisma.tenderEvent.create({ data: { tenderId, userId: ctx.user.id, action: input.done ? 'DEADLINE_DONE' : 'DEADLINE_REOPENED', toValue: before.title } });
  return d;
}
export async function removeDeadline(tenderId: string, id: string): Promise<void> {
  const r = await prisma.tenderDeadline.deleteMany({ where: { id, tenderId } });
  if (!r.count) throw notFound('Prazo não encontrado');
}

// ---------------- concorrentes ----------------
export async function addCompetitor(ctx: Ctx, tenderId: string, input: z.infer<typeof tenderCompetitorSchema>) {
  await get(tenderId);
  const c = await prisma.tenderCompetitor.create({ data: { tenderId, name: input.name, document: input.document ?? null, proposalValue: D(input.proposalValue) ?? null, rank: input.rank ?? null, isWinner: input.isWinner, notes: input.notes ?? null } });
  if (input.isWinner) await prisma.tender.update({ where: { id: tenderId }, data: { winnerValue: c.proposalValue } });
  await prisma.tenderEvent.create({ data: { tenderId, userId: ctx.user.id, action: 'COMPETITOR_ADDED', toValue: `${input.name}${input.proposalValue ? ` · R$ ${input.proposalValue}` : ''}${input.isWinner ? ' (vencedor)' : ''}` } });
  return c;
}
export async function removeCompetitor(tenderId: string, id: string): Promise<void> {
  const r = await prisma.tenderCompetitor.deleteMany({ where: { id, tenderId } });
  if (!r.count) throw notFound('Concorrente não encontrado');
}

// ---------------- checklist ----------------
export async function addChecklistItem(tenderId: string, input: z.infer<typeof tenderChecklistItemSchema>) {
  const t = await get(tenderId);
  return prisma.tenderChecklistItem.create({ data: { tenderId, title: input.title, certificateId: input.certificateId ?? null, documentId: input.documentId ?? null, required: input.required, done: input.done, position: t.checklist.length, notes: input.notes ?? null } });
}
export async function updateChecklistItem(ctx: Ctx, tenderId: string, id: string, input: z.infer<typeof updateTenderChecklistItemSchema>) {
  const before = await prisma.tenderChecklistItem.findFirst({ where: { id, tenderId } });
  if (!before) throw notFound('Item não encontrado');
  const c = await prisma.tenderChecklistItem.update({ where: { id }, data: input });
  if (input.done !== undefined && input.done !== before.done) await prisma.tenderEvent.create({ data: { tenderId, userId: ctx.user.id, action: input.done ? 'CHECKLIST_DONE' : 'CHECKLIST_REOPENED', toValue: before.title } });
  return c;
}
export async function removeChecklistItem(tenderId: string, id: string): Promise<void> {
  const r = await prisma.tenderChecklistItem.deleteMany({ where: { id, tenderId } });
  if (!r.count) throw notFound('Item não encontrado');
}

// ---------------- documentos ----------------
export async function addDocument(ctx: Ctx, tenderId: string, file: File, name?: string) {
  const t = await get(tenderId);
  const mimeType = file.type || 'application/octet-stream';
  if (file.size > 25 * 1024 * 1024) throw badRequest('Arquivo excede 25 MB');
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!buffer.length) throw badRequest('Arquivo vazio');
  const r = await storeDocument({ buffer, mimeType, name: name ?? file.name ?? `Licitação ${t.number}`, type: 'TENDER', entityId: t.entity.id, tenderId, uploadedByUserId: ctx.user.id, origin: 'MANUAL' });
  await prisma.tenderEvent.create({ data: { tenderId, userId: ctx.user.id, action: 'DOCUMENT_ADDED', toValue: name ?? file.name } });
  await audit(ctx, { action: 'DOCUMENT_UPLOADED', resource: 'tender', resourceId: tenderId, after: { documentId: r.documentId, size: buffer.length } });
  return getDocument(r.documentId);
}

// ---------------- homologação → contrato ----------------
export async function formalize(ctx: Ctx, id: string, input: z.infer<typeof formalizeTenderSchema>): Promise<{ contractId: string; status: string }> {
  const t = await prisma.tender.findFirst({ where: { id, deletedAt: null }, include: { contracts: { select: { id: true } } } });
  if (!t) throw notFound('Licitação não encontrada');
  if (t.status !== 'HOMOLOGATED' && t.status !== 'WON') throw badRequest('Só licitações vencidas/homologadas podem ser formalizadas');
  if (t.contracts.length) throw badRequest('Esta licitação já gerou um contrato');
  const dup = await prisma.contract.findFirst({ where: { entityId: t.entityId, number: input.number, deletedAt: null } });
  if (dup) throw badRequest(`Já existe o contrato ${input.number} nesta entidade`);
  const contract = await createContract(ctx, { entityId: t.entityId, number: input.number, object: input.object ?? t.object, description: null, monthlyValue: input.monthlyValue ?? null, totalValue: input.totalValue ?? (t.ourProposalValue ? t.ourProposalValue.toFixed(2) : null), startDate: input.startDate ?? null, endDate: input.endDate ?? null, status: input.activate ? 'ACTIVE' : 'DRAFT', expectsMonthlyBilling: Boolean(input.monthlyValue), responsibleUserId: input.responsibleUserId ?? t.ownerUserId ?? null, notes: input.notes ?? `Origem: licitação ${t.number} (${TENDER_MODALITY_LABELS[t.modality as TenderModality] ?? t.modality})` });
  await prisma.contract.update({ where: { id: contract.id }, data: { tenderId: id, opportunityId: t.opportunityId } });
  if (input.activate && input.issuanceDay) await createAlarm(ctx, { entityId: t.entityId, contractNumber: input.number, label: 'Emissão da nota', dayOfMonth: input.issuanceDay, leadDays: 5, notes: `Criado na formalização da licitação ${t.number}` });
  await prisma.tender.update({ where: { id }, data: { status: 'HOMOLOGATED', homologatedAt: t.homologatedAt ?? isoToDate(todayIso()), events: { create: { userId: ctx.user.id, action: 'FORMALIZED', toValue: `${input.number} (${input.activate ? 'ativo' : 'rascunho'})` } } } });
  await audit(ctx, { action: 'UPDATE', resource: 'tender', resourceId: id, after: { contractId: contract.id, status: contract.status } });
  return { contractId: contract.id, status: contract.status };
}

// ---------------- alertas (cron) ----------------
export async function notifyDeadlines(today = todayIso()): Promise<{ due: number; overdue: number }> {
  const s = await prisma.setting.findUnique({ where: { key: 'tenders.alertDays' } });
  const days = typeof s?.value === 'number' ? s.value : 3;
  const rows = await prisma.tenderDeadline.findMany({ where: { done: false, dueAt: { lte: new Date(`${addDaysIso(today, days)}T23:59:59Z`) }, tender: { deletedAt: null, status: { in: ['IDENTIFIED', 'ANALYZING', 'PREPARING', 'SUBMITTED', 'IN_SESSION', 'WON'] } } }, include: { tender: { select: { id: true, number: true, entityId: true, ownerUserId: true, entity: { select: { name: true, shortName: true } } } } } });
  let due = 0, overdue = 0;
  for (const d of rows) {
    const isOver = dateToIso(d.dueAt)! < today; if (isOver) overdue += 1; else due += 1;
    const key = `TENDER_DEADLINE:${d.id}:${today}`;
    await prisma.notification.upsert({ where: { dedupeKey: key }, update: {}, create: { organizationId: currentOrgId(), type: 'TENDER_DEADLINE', userId: d.tender.ownerUserId, title: `${isOver ? 'Prazo vencido' : 'Prazo próximo'}: ${d.title} — licitação ${d.tender.number} (${d.tender.entity.shortName ?? d.tender.entity.name}) em ${d.dueAt.toISOString().slice(0, 16).replace('T', ' ')}`, entityId: d.tender.entityId, referenceType: 'tender', referenceId: d.tender.id, dedupeKey: key } });
  }
  return { due, overdue };
}

// ---------------- PNCP ----------------
function mapPncp(r: PncpRaw): Omit<PncpPublication, 'match'> {
  const code = r.modalidadeId ?? 0;
  return {
    officialId: r.numeroControlePNCP, modalityCode: code, modality: PNCP_MODALITIES[code] ?? 'OUTRA', number: r.numeroCompra ?? r.numeroControlePNCP, year: r.anoCompra ?? null, object: (r.objetoCompra ?? '').slice(0, 4000),
    estimatedValue: r.valorTotalEstimado ? Number(r.valorTotalEstimado).toFixed(2) : null, publishedAt: r.dataPublicacaoPncp ? r.dataPublicacaoPncp.slice(0, 10) : null, proposalOpensAt: r.dataAberturaProposta ?? null, proposalDeadline: r.dataEncerramentoProposta ?? null,
    orgName: r.orgaoEntidade?.razaoSocial ?? '', orgDocument: r.orgaoEntidade?.cnpj ?? null, unitName: r.unidadeOrgao?.nomeUnidade ?? null, municipality: r.unidadeOrgao?.municipioNome ?? null, uf: r.unidadeOrgao?.ufSigla ?? null,
    portalUrl: r.linkSistemaOrigem ?? null, situation: r.situacaoCompraNome ?? null,
  };
}

/** Casa o órgão do PNCP com uma entidade: CNPJ, depois município+UF (câmara se o nome do órgão mencionar "câmara", senão prefeitura/outro). */
async function matchEntity(p: Omit<PncpPublication, 'match'>): Promise<{ id: string; name: string } | null> {
  if (p.orgDocument) { const byDoc = await prisma.entity.findFirst({ where: { deletedAt: null, cnpj: p.orgDocument.replace(/\D/g, '') }, select: { id: true, name: true } }); if (byDoc) return byDoc; }
  if (!p.municipality || !p.uf) return null;
  const isCamara = /c[aâ]mara/i.test(p.orgName);
  const cands = await prisma.entity.findMany({ where: { deletedAt: null, uf: p.uf.toUpperCase() }, select: { id: true, name: true, municipality: true, type: true } });
  const target = norm(p.municipality);
  const same = cands.filter((c) => norm(c.municipality) === target);
  return same.find((c) => (isCamara ? c.type === 'CM' : c.type !== 'CM')) ?? same[0] ?? null;
}

/** Consulta pública (PNCP ou Compras.gov) pela integração configurada, com log e contabilização de falhas. */
async function fetchPublications(source: 'PNCP' | 'COMPRASGOV', s: PncpSearch): Promise<{ items: PncpRaw[]; warnings: string[] }> {
  const key = source === 'COMPRASGOV' ? 'COMPRASGOV' : 'PNCP';
  const cfg = await resolve(key);
  if (!cfg.enabled) throw badRequest(`Integração ${key} desativada`);
  return call(key, 'FETCH', { request: { uf: s.uf, from: s.from, to: s.to, modalities: s.modalities } }, async () => {
    const r = source === 'COMPRASGOV' ? await fetchComprasGov(s, { ...providerCtx(), apiUrl: cfg.config['apiUrl'] }) : await fetchPncpPublications(s, { ...providerCtx(), apiUrl: cfg.config['apiUrl'] });
    return { result: r, response: { items: r.items.length, warnings: r.warnings }, ok: true };
  });
}

export async function searchPncp(input: z.infer<typeof pncpSearchSchema>): Promise<{ items: PncpPublication[]; warnings: string[]; total: number }> {
  const { items, warnings } = await fetchPublications(input.source, { uf: input.uf, from: input.from, to: input.to, modalities: input.modalities });
  const mapped = items.map(mapPncp).filter((p) => !input.q || norm(`${p.object} ${p.orgName}`).includes(norm(input.q)));
  const ids = mapped.map((m) => m.officialId);
  const existing = ids.length ? await prisma.tender.findMany({ where: { officialId: { in: ids } }, select: { id: true, officialId: true } }) : [];
  const ex = new Map(existing.map((e) => [e.officialId!, e.id]));
  const out: PncpPublication[] = [];
  for (const m of mapped) {
    const ent = await matchEntity(m);
    if (input.onlyLinkedEntities && !ent) continue;
    out.push({ ...m, match: { entityId: ent?.id ?? null, entityName: ent?.name ?? null, alreadyImportedId: ex.get(m.officialId) ?? null } });
  }
  return { items: out, warnings, total: out.length };
}

/** Importa publicações selecionadas (refaz a consulta para não confiar em dados do cliente). Sem entidade casada, cria a entidade como lead (PM/CM pelo nome do órgão). */
export async function importPncp(ctx: Ctx, input: z.infer<typeof pncpImportSchema>): Promise<{ created: number; skipped: number; entitiesCreated: number; errors: string[] }> {
  const { items } = await fetchPublications(input.source, { uf: input.uf, from: input.from, to: input.to, modalities: input.modalities });
  const byId = new Map(items.map((r) => [r.numeroControlePNCP, mapPncp(r)]));
  const res = { created: 0, skipped: 0, entitiesCreated: 0, errors: [] as string[] };
  const org = currentOrgId();
  for (const sel of input.items) {
    const p = byId.get(sel.officialId);
    if (!p) { res.errors.push(`${sel.officialId}: não encontrado na consulta`); continue; }
    if (await prisma.tender.findFirst({ where: { officialId: p.officialId }, select: { id: true } })) { res.skipped += 1; continue; }
    let entityId = sel.entityId ?? (await matchEntity(p))?.id ?? null;
    if (!entityId) {
      if (!sel.createEntity || !p.municipality || !p.uf) { res.errors.push(`${p.officialId}: sem entidade para vincular`); continue; }
      const isCamara = /c[aâ]mara/i.test(p.orgName); const type = isCamara ? 'CM' : 'PM';
      const municipality = p.municipality.trim().replace(/\s+/g, ' ');
      const name = isCamara ? `CÂMARA MUNICIPAL DE ${municipality.toUpperCase()}` : `PREFEITURA MUNICIPAL DE ${municipality.toUpperCase()}`;
      const existing = await prisma.entity.findFirst({ where: { type, municipality: { equals: municipality, mode: 'insensitive' }, uf: p.uf.toUpperCase(), deletedAt: null }, select: { id: true } });
      if (existing) entityId = existing.id;
      else { const e = await prisma.entity.create({ data: { organizationId: org, type, name, shortName: `${type} ${municipality.toUpperCase()}`, municipality, uf: p.uf.toUpperCase(), cnpj: p.orgDocument?.replace(/\D/g, '') ?? null, notes: `Criada pela importação do PNCP (${p.orgName})` } }); entityId = e.id; res.entitiesCreated += 1; }
    }
    try {
      await create(ctx, { entityId, modality: p.modality as TenderModality, number: p.number, year: p.year, officialId: p.officialId, object: p.object || '(sem objeto)', estimatedValue: p.estimatedValue, publishedAt: p.publishedAt, proposalDeadline: p.proposalDeadline ? p.proposalDeadline.slice(0, 16) : null, sessionAt: null, portalUrl: p.portalUrl && /^https?:\/\//.test(p.portalUrl) ? p.portalUrl : null, ownerUserId: ctx.user.id, notes: `Importada do PNCP em ${todayIso()} · ${p.orgName}${p.unitName ? ` / ${p.unitName}` : ''}${p.situation ? ` · situação: ${p.situation}` : ''}`, ourProposalValue: null, opportunityId: null });
      await prisma.tender.updateMany({ where: { officialId: p.officialId }, data: { source: 'PNCP' } });
      res.created += 1;
    } catch (e) { res.errors.push(`${p.officialId}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return res;
}

// ---------------- planilha ----------------
/** Colunas: entidade (nome curto ou completo) | modalidade | numero | objeto | valor_estimado | proposta (dd/mm/aaaa hh:mm) | sessao | url | id_oficial */
export async function importSheet(ctx: Ctx, file: ImportFile): Promise<{ created: number; skipped: number; errors: Array<{ line: number; error: string }> }> {
  const { entities: rowsA, invoices: rowsB } = await parseSheets(file);
  const rows = [...rowsA, ...rowsB];
  const res = { created: 0, skipped: 0, errors: [] as Array<{ line: number; error: string }> };
  const all = await prisma.entity.findMany({ where: { deletedAt: null }, select: { id: true, name: true, shortName: true } });
  const find = (s: string) => { const n = norm(s); return all.find((e) => norm(e.shortName ?? '') === n || norm(e.name) === n) ?? null; };
  const brDate = (s: string): string | null => { const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/); return m ? `${m[3]}-${m[2]}-${m[1]}${m[4] ? `T${m[4]}:${m[5]}` : ''}` : s.match(/^\d{4}-\d{2}-\d{2}/) ? s.slice(0, 16) : null; };
  const modality = (s: string): TenderModality => (Object.entries(TENDER_MODALITY_LABELS).find(([k, v]) => norm(v) === norm(s) || norm(k) === norm(s))?.[0] as TenderModality) ?? 'OUTRA';
  for (const [i, r] of rows.entries()) {
    const line = i + 2;
    try {
      const ent = r['entidade'] ? find(r['entidade']) : null;
      if (!ent) throw new Error(`entidade "${r['entidade'] ?? ''}" não encontrada`);
      if (!r['numero'] || !r['objeto']) throw new Error('numero e objeto são obrigatórios');
      if (r['id_oficial'] && (await prisma.tender.findFirst({ where: { officialId: r['id_oficial'], deletedAt: null }, select: { id: true } }))) { res.skipped += 1; continue; }
      await create(ctx, { entityId: ent.id, modality: modality(r['modalidade'] ?? ''), number: r['numero']!, year: null, officialId: r['id_oficial'] || null, object: r['objeto']!, estimatedValue: r['valor_estimado'] ? r['valor_estimado'].replace(/\./g, '').replace(',', '.') : null, publishedAt: null, proposalDeadline: r['proposta'] ? brDate(r['proposta']) : null, sessionAt: r['sessao'] ? brDate(r['sessao']) : null, portalUrl: r['url'] && /^https?:\/\//.test(r['url']) ? r['url'] : null, ownerUserId: ctx.user.id, notes: 'Importada por planilha', ourProposalValue: null, opportunityId: null });
      res.created += 1;
    } catch (e) { res.errors.push({ line, error: e instanceof Error ? e.message : String(e) }); }
  }
  return res;
}
