/**
 * Oportunidades comerciais (módulo 2): CRUD, itens, movimentação no funil, ganho/perda/reabertura,
 * histórico, oportunidades paradas (SLA da etapa ou `crm.stalledDays`) e formalização em contrato.
 * Regra: "Ganho" NÃO cria contrato ativo — a formalização é um passo explícito, em rascunho por padrão.
 */
import { Prisma } from '@siow/db';
import { dateToIso, daysBetween, isoToDate, todayIso, type OpportunityEventRow, type OpportunityRow, type Paginated } from '@siow/shared';
import type { z } from 'zod';
import type { createOpportunitySchema, formalizeOpportunitySchema, loseOpportunitySchema, moveOpportunitySchema, opportunityListFilterSchema, reopenOpportunitySchema, updateOpportunitySchema, winOpportunitySchema } from '@siow/shared';
import { prisma } from '../../db.js';
import { currentOrgId } from '../../tenant.js';
import { audit } from '../../audit.js';
import { badRequest, notFound, type Ctx } from '../../http.js';
import { ensureDefault } from './pipelines.js';
import { create as createContract } from '../contracts.js';
import { create as createAlarm } from '../alarms.js';

const D = (v: string | number | null | undefined): Prisma.Decimal | null => (v === null || v === undefined || v === '' ? null : new Prisma.Decimal(v));
const str = (d: Prisma.Decimal | null | undefined): string | null => (d ? d.toFixed(2) : null);

export const include = {
  entity: { select: { id: true, name: true, shortName: true, type: true, municipality: true, uf: true } },
  stage: true,
  owner: { select: { id: true, name: true } },
  items: { orderBy: { position: 'asc' as const } },
  _count: { select: { proposals: true } },
} satisfies Prisma.OpportunityInclude;
type Row = Prisma.OpportunityGetPayload<{ include: typeof include }>;

export async function stalledDaysDefault(): Promise<number> {
  const s = await prisma.setting.findUnique({ where: { key: 'crm.stalledDays' } });
  return typeof s?.value === 'number' && s.value > 0 ? s.value : 15;
}

/** Oportunidade parada: em andamento, sem movimentação de etapa nem atividade há mais dias que o SLA da etapa (ou o padrão). */
export function isStalled(o: { status: string; stageEnteredAt: Date; lastActivityAt: Date | null; stage: { slaDays: number | null } }, fallbackDays: number, today = todayIso()): boolean {
  if (o.status !== 'OPEN') return false;
  const limit = o.stage.slaDays ?? fallbackDays;
  const last = o.lastActivityAt && o.lastActivityAt > o.stageEnteredAt ? o.lastActivityAt : o.stageEnteredAt;
  return daysBetween(last.toISOString().slice(0, 10), today) > limit;
}

function computeTotal(monthly: Prisma.Decimal | null, oneTime: Prisma.Decimal | null, termMonths: number | null): Prisma.Decimal | null {
  if (!monthly && !oneTime) return null;
  const m = monthly ? monthly.mul(termMonths ?? 12) : new Prisma.Decimal(0);
  return m.add(oneTime ?? 0);
}

export function toRow(o: Row, fallbackDays: number, extra?: { nextTask?: OpportunityRow['nextTask']; openTaskCount?: number }): OpportunityRow {
  const today = todayIso();
  const prob = o.status === 'WON' ? 100 : o.status === 'LOST' ? 0 : o.probability ?? o.stage.probability;
  const total = o.totalAmount ?? computeTotal(o.monthlyAmount, o.oneTimeAmount, o.termMonths);
  return {
    id: o.id, title: o.title, description: o.description, status: o.status,
    entity: o.entity, pipelineId: o.pipelineId,
    stage: { id: o.stage.id, pipelineId: o.stage.pipelineId, name: o.stage.name, position: o.stage.position, probability: o.stage.probability, kind: o.stage.kind as 'OPEN' | 'WON' | 'LOST', slaDays: o.stage.slaDays, color: o.stage.color },
    monthlyAmount: str(o.monthlyAmount), oneTimeAmount: str(o.oneTimeAmount), termMonths: o.termMonths, totalAmount: str(total),
    probability: o.probability, effectiveProbability: prob, weightedAmount: total ? total.mul(prob).div(100).toFixed(2) : '0.00',
    expectedCloseDate: dateToIso(o.expectedCloseDate), source: o.source,
    owner: o.owner, lostReason: o.lostReason, lostNotes: o.lostNotes,
    wonAt: o.wonAt?.toISOString() ?? null, lostAt: o.lostAt?.toISOString() ?? null, contractId: o.contractId,
    stageEnteredAt: o.stageEnteredAt.toISOString(), daysInStage: daysBetween(o.stageEnteredAt.toISOString().slice(0, 10), today),
    stalled: isStalled(o, fallbackDays, today), lastActivityAt: o.lastActivityAt?.toISOString() ?? null,
    nextTask: extra?.nextTask ?? null, proposalCount: o._count.proposals, openTaskCount: extra?.openTaskCount ?? 0,
    createdAt: o.createdAt.toISOString(), updatedAt: o.updatedAt.toISOString(),
  };
}

async function taskExtras(ids: string[]): Promise<Record<string, { nextTask: OpportunityRow['nextTask']; openTaskCount: number }>> {
  if (!ids.length) return {};
  const tasks = await prisma.financialTask.findMany({ where: { opportunityId: { in: ids }, deletedAt: null, status: { in: ['PENDING', 'IN_PROGRESS'] } }, select: { id: true, opportunityId: true, title: true, dueDate: true, status: true }, orderBy: { dueDate: 'asc' } });
  const out: Record<string, { nextTask: OpportunityRow['nextTask']; openTaskCount: number }> = {};
  for (const t of tasks) {
    const e = (out[t.opportunityId!] ??= { nextTask: null, openTaskCount: 0 });
    e.openTaskCount += 1;
    if (!e.nextTask) e.nextTask = { id: t.id, title: t.title, dueDate: t.dueDate.toISOString().slice(0, 10), status: t.status };
  }
  return out;
}

export async function list(f: z.infer<typeof opportunityListFilterSchema>): Promise<Paginated<OpportunityRow>> {
  const where: Prisma.OpportunityWhereInput = { deletedAt: null, entityId: f.entityId, pipelineId: f.pipelineId, stageId: f.stageId, status: f.status, source: f.source };
  if (f.ownerUserId === 'unassigned') where.ownerUserId = null; else if (f.ownerUserId) where.ownerUserId = f.ownerUserId;
  if (f.uf) where.entity = { uf: f.uf.toUpperCase() };
  if (f.q) where.OR = [{ title: { contains: f.q, mode: 'insensitive' } }, { entity: { name: { contains: f.q, mode: 'insensitive' } } }, { entity: { municipality: { contains: f.q, mode: 'insensitive' } } }];
  if (f.closeFrom || f.closeTo) where.expectedCloseDate = { gte: f.closeFrom ? isoToDate(f.closeFrom) : undefined, lte: f.closeTo ? isoToDate(f.closeTo) : undefined };
  const fallback = await stalledDaysDefault();
  const orderBy: Prisma.OpportunityOrderByWithRelationInput = f.sortBy === 'title' ? { title: f.sortDir === 'asc' ? 'asc' : 'desc' } : { [f.sortBy]: f.sortDir === 'asc' ? 'asc' : 'desc' };
  // "paradas" é calculado (SLA por etapa): filtra em memória sobre o recorte, mantendo a paginação coerente
  if (f.stalled) {
    const all = await prisma.opportunity.findMany({ where: { ...where, status: 'OPEN' }, include, orderBy });
    const stalled = all.filter((o) => isStalled(o, fallback));
    const page = stalled.slice((f.page - 1) * f.pageSize, f.page * f.pageSize);
    const extras = await taskExtras(page.map((o) => o.id));
    return { items: page.map((o) => toRow(o, fallback, extras[o.id])), total: stalled.length, page: f.page, pageSize: f.pageSize };
  }
  const [rows, total] = await Promise.all([
    prisma.opportunity.findMany({ where, include, orderBy, skip: (f.page - 1) * f.pageSize, take: f.pageSize }),
    prisma.opportunity.count({ where }),
  ]);
  const extras = await taskExtras(rows.map((o) => o.id));
  return { items: rows.map((o) => toRow(o, fallback, extras[o.id])), total, page: f.page, pageSize: f.pageSize };
}

/** Kanban: todas as oportunidades em andamento do funil, agrupadas por etapa (sem paginação; ordenadas por valor). */
export async function board(pipelineId?: string, ownerUserId?: string): Promise<{ pipeline: Awaited<ReturnType<typeof ensureDefault>>; columns: Array<{ stage: OpportunityRow['stage']; items: OpportunityRow[]; amount: string }> }> {
  const pipeline = pipelineId ? await import('./pipelines.js').then((m) => m.get(pipelineId)) : await ensureDefault();
  const fallback = await stalledDaysDefault();
  const rows = await prisma.opportunity.findMany({ where: { deletedAt: null, pipelineId: pipeline.id, ownerUserId: ownerUserId || undefined, OR: [{ status: 'OPEN' }, { status: { in: ['WON', 'LOST'] }, updatedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }] }, include, orderBy: [{ updatedAt: 'desc' }] });
  const extras = await taskExtras(rows.map((o) => o.id));
  const items = rows.map((o) => toRow(o, fallback, extras[o.id]));
  const columns = pipeline.stages.map((stage) => {
    const its = items.filter((i) => i.stage.id === stage.id).sort((a, b) => Number(b.totalAmount ?? 0) - Number(a.totalAmount ?? 0));
    return { stage, items: its, amount: its.reduce((acc, i) => acc.add(i.totalAmount ?? 0), new Prisma.Decimal(0)).toFixed(2) };
  });
  return { pipeline, columns };
}

export async function get(id: string): Promise<OpportunityRow & { items: Array<{ id: string; catalogItemId: string | null; description: string; quantity: string; unitPrice: string; recurrence: string; total: string; position: number }>; events: OpportunityEventRow[] }> {
  const o = await prisma.opportunity.findFirst({ where: { id, deletedAt: null }, include: { ...include, events: { orderBy: { createdAt: 'desc' }, take: 200 } } });
  if (!o) throw notFound('Oportunidade não encontrada');
  const fallback = await stalledDaysDefault();
  const extras = await taskExtras([id]);
  const userIds = [...new Set(o.events.map((e) => e.userId).filter(Boolean) as string[])];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  return {
    ...toRow(o, fallback, extras[id]),
    items: o.items.map((i) => ({ id: i.id, catalogItemId: i.catalogItemId, description: i.description, quantity: i.quantity.toFixed(2), unitPrice: i.unitPrice.toFixed(2), recurrence: i.recurrence, total: i.total.toFixed(2), position: i.position })),
    events: o.events.map((e) => ({ id: e.id, action: e.action, fromValue: e.fromValue, toValue: e.toValue, notes: e.notes, createdAt: e.createdAt.toISOString(), userName: e.userId ? nameOf.get(e.userId) ?? null : null })),
  };
}

type ItemInput = z.infer<typeof createOpportunitySchema>['items'];
function itemsData(org: string, items: NonNullable<ItemInput>): Prisma.OpportunityItemUncheckedCreateWithoutOpportunityInput[] {
  return items.map((it, i) => {
    const total = new Prisma.Decimal(it.unitPrice).mul(it.quantity);
    return { organizationId: org, catalogItemId: it.catalogItemId ?? null, description: it.description, quantity: new Prisma.Decimal(it.quantity), unitPrice: new Prisma.Decimal(it.unitPrice), recurrence: it.recurrence, total, position: i };
  });
}
/** Com itens informados, os valores mensal/único da oportunidade passam a ser a soma dos itens. */
function amountsFromItems(items: NonNullable<ItemInput>): { monthly: Prisma.Decimal; oneTime: Prisma.Decimal } {
  let monthly = new Prisma.Decimal(0); let oneTime = new Prisma.Decimal(0);
  for (const it of items) {
    const total = new Prisma.Decimal(it.unitPrice).mul(it.quantity);
    if (it.recurrence === 'MONTHLY') monthly = monthly.add(total);
    else if (it.recurrence === 'YEARLY') monthly = monthly.add(total.div(12));
    else oneTime = oneTime.add(total);
  }
  return { monthly, oneTime };
}

export async function create(ctx: Ctx, input: z.infer<typeof createOpportunitySchema>): Promise<OpportunityRow> {
  const entity = await prisma.entity.findFirst({ where: { id: input.entityId, deletedAt: null }, select: { id: true } });
  if (!entity) throw notFound('Entidade não encontrada');
  const pipeline = input.pipelineId ? await import('./pipelines.js').then((m) => m.get(input.pipelineId!)) : await ensureDefault();
  const stage = input.stageId ? pipeline.stages.find((s) => s.id === input.stageId) : pipeline.stages.find((s) => s.kind === 'OPEN');
  if (!stage) throw badRequest('Etapa inválida para este funil');
  if (stage.kind !== 'OPEN') throw badRequest('Uma oportunidade nova precisa começar numa etapa em andamento');
  const org = currentOrgId();
  let monthly = D(input.monthlyAmount); let oneTime = D(input.oneTimeAmount);
  if (input.items?.length) { const a = amountsFromItems(input.items); monthly = a.monthly; oneTime = a.oneTime; }
  const o = await prisma.opportunity.create({
    data: {
      organizationId: org, entityId: input.entityId, pipelineId: pipeline.id, stageId: stage.id, title: input.title, description: input.description ?? null,
      monthlyAmount: monthly, oneTimeAmount: oneTime, termMonths: input.termMonths ?? null, totalAmount: computeTotal(monthly, oneTime, input.termMonths ?? null),
      probability: input.probability ?? null, expectedCloseDate: input.expectedCloseDate ? isoToDate(input.expectedCloseDate) : null, source: input.source ?? null,
      ownerUserId: input.ownerUserId ?? ctx.user.id, createdByUserId: ctx.user.id, lastActivityAt: new Date(),
      items: input.items?.length ? { create: itemsData(org, input.items) } : undefined,
      events: { create: { userId: ctx.user.id, action: 'CREATED', toValue: stage.name } },
    },
    include,
  });
  await audit(ctx, { action: 'CREATE', resource: 'opportunity', resourceId: o.id, after: { title: o.title, entityId: o.entityId, stage: stage.name, totalAmount: o.totalAmount } });
  return toRow(o, await stalledDaysDefault());
}

export async function update(ctx: Ctx, id: string, input: z.infer<typeof updateOpportunitySchema>): Promise<OpportunityRow> {
  const before = await prisma.opportunity.findFirst({ where: { id, deletedAt: null }, include });
  if (!before) throw notFound('Oportunidade não encontrada');
  const org = currentOrgId();
  let monthly = input.monthlyAmount !== undefined ? D(input.monthlyAmount) : before.monthlyAmount;
  let oneTime = input.oneTimeAmount !== undefined ? D(input.oneTimeAmount) : before.oneTimeAmount;
  if (input.items) { const a = amountsFromItems(input.items); monthly = a.monthly; oneTime = a.oneTime; }
  const termMonths = input.termMonths !== undefined ? input.termMonths : before.termMonths;
  const events: Prisma.OpportunityEventUncheckedCreateWithoutOpportunityInput[] = [];
  if (input.ownerUserId !== undefined && input.ownerUserId !== before.ownerUserId) events.push({ userId: ctx.user.id, action: 'REASSIGNED', fromValue: before.owner?.name ?? null, toValue: input.ownerUserId ?? null });
  const newTotal = computeTotal(monthly, oneTime, termMonths);
  if ((newTotal?.toFixed(2) ?? null) !== (before.totalAmount?.toFixed(2) ?? null)) events.push({ userId: ctx.user.id, action: 'AMOUNT_CHANGED', fromValue: before.totalAmount?.toFixed(2) ?? null, toValue: newTotal?.toFixed(2) ?? null });
  const o = await prisma.$transaction(async (tx) => {
    if (input.items) { await tx.opportunityItem.deleteMany({ where: { opportunityId: id } }); }
    return tx.opportunity.update({
      where: { id },
      data: {
        title: input.title, description: input.description, monthlyAmount: monthly, oneTimeAmount: oneTime, termMonths, totalAmount: newTotal,
        probability: input.probability, expectedCloseDate: input.expectedCloseDate === undefined ? undefined : input.expectedCloseDate ? isoToDate(input.expectedCloseDate) : null,
        source: input.source, ownerUserId: input.ownerUserId, lastActivityAt: new Date(),
        items: input.items ? { create: itemsData(org, input.items) } : undefined,
        events: events.length ? { create: events } : undefined,
      },
      include,
    });
  });
  await audit(ctx, { action: 'UPDATE', resource: 'opportunity', resourceId: id, before: { title: before.title, totalAmount: before.totalAmount, ownerUserId: before.ownerUserId }, after: { title: o.title, totalAmount: o.totalAmount, ownerUserId: o.ownerUserId } });
  return toRow(o, await stalledDaysDefault());
}

export async function move(ctx: Ctx, id: string, input: z.infer<typeof moveOpportunitySchema>): Promise<OpportunityRow> {
  const before = await prisma.opportunity.findFirst({ where: { id, deletedAt: null }, include });
  if (!before) throw notFound('Oportunidade não encontrada');
  if (before.status !== 'OPEN') throw badRequest('Oportunidade encerrada: reabra antes de mover');
  const stage = await prisma.pipelineStage.findFirst({ where: { id: input.stageId, pipelineId: before.pipelineId } });
  if (!stage) throw badRequest('Etapa inválida para este funil');
  if (stage.kind === 'WON') throw badRequest('Use "Marcar como ganha" para concluir a oportunidade');
  if (stage.kind === 'LOST') throw badRequest('Use "Marcar como perdida" informando o motivo');
  if (stage.id === before.stageId) return toRow(before, await stalledDaysDefault());
  const o = await prisma.opportunity.update({ where: { id }, data: { stageId: stage.id, stageEnteredAt: new Date(), lastActivityAt: new Date(), events: { create: { userId: ctx.user.id, action: 'STAGE_CHANGED', fromValue: before.stage.name, toValue: stage.name, notes: input.notes ?? null } } }, include });
  await audit(ctx, { action: 'UPDATE', resource: 'opportunity', resourceId: id, before: { stage: before.stage.name }, after: { stage: stage.name } });
  return toRow(o, await stalledDaysDefault());
}

export async function win(ctx: Ctx, id: string, input: z.infer<typeof winOpportunitySchema>): Promise<OpportunityRow> {
  const before = await prisma.opportunity.findFirst({ where: { id, deletedAt: null }, include });
  if (!before) throw notFound('Oportunidade não encontrada');
  if (before.status === 'WON') return toRow(before, await stalledDaysDefault());
  const stage = await prisma.pipelineStage.findFirst({ where: { pipelineId: before.pipelineId, kind: 'WON' } });
  if (!stage) throw badRequest('O funil não tem etapa "Ganho"');
  const o = await prisma.opportunity.update({ where: { id }, data: { status: 'WON', stageId: stage.id, stageEnteredAt: new Date(), wonAt: new Date(), lostAt: null, lostReason: null, lostNotes: null, lastActivityAt: new Date(), events: { create: { userId: ctx.user.id, action: 'WON', fromValue: before.stage.name, toValue: stage.name, notes: input.notes ?? null } } }, include });
  await audit(ctx, { action: 'UPDATE', resource: 'opportunity', resourceId: id, before: { status: before.status, stage: before.stage.name }, after: { status: 'WON' }, justification: input.notes ?? undefined });
  return toRow(o, await stalledDaysDefault());
}

export async function lose(ctx: Ctx, id: string, input: z.infer<typeof loseOpportunitySchema>): Promise<OpportunityRow> {
  const before = await prisma.opportunity.findFirst({ where: { id, deletedAt: null }, include });
  if (!before) throw notFound('Oportunidade não encontrada');
  if (before.contractId) throw badRequest('Oportunidade já formalizada em contrato: não pode ser marcada como perdida');
  const stage = await prisma.pipelineStage.findFirst({ where: { pipelineId: before.pipelineId, kind: 'LOST' } });
  if (!stage) throw badRequest('O funil não tem etapa "Perdido"');
  const o = await prisma.opportunity.update({ where: { id }, data: { status: 'LOST', stageId: stage.id, stageEnteredAt: new Date(), lostAt: new Date(), wonAt: null, lostReason: input.reason, lostNotes: input.notes ?? null, lastActivityAt: new Date(), events: { create: { userId: ctx.user.id, action: 'LOST', fromValue: before.stage.name, toValue: input.reason, notes: input.notes ?? null } } }, include });
  await audit(ctx, { action: 'UPDATE', resource: 'opportunity', resourceId: id, before: { status: before.status, stage: before.stage.name }, after: { status: 'LOST', reason: input.reason }, justification: input.notes ?? undefined });
  return toRow(o, await stalledDaysDefault());
}

export async function reopen(ctx: Ctx, id: string, input: z.infer<typeof reopenOpportunitySchema>): Promise<OpportunityRow> {
  const before = await prisma.opportunity.findFirst({ where: { id, deletedAt: null }, include });
  if (!before) throw notFound('Oportunidade não encontrada');
  if (before.status === 'OPEN') return toRow(before, await stalledDaysDefault());
  if (before.contractId) throw badRequest('Oportunidade já formalizada em contrato: não pode ser reaberta');
  const stages = await prisma.pipelineStage.findMany({ where: { pipelineId: before.pipelineId, kind: 'OPEN' }, orderBy: { position: 'asc' } });
  const stage = input.stageId ? stages.find((s) => s.id === input.stageId) : stages.at(-1);
  if (!stage) throw badRequest('Etapa inválida');
  const o = await prisma.opportunity.update({ where: { id }, data: { status: 'OPEN', stageId: stage.id, stageEnteredAt: new Date(), wonAt: null, lostAt: null, lostReason: null, lostNotes: null, lastActivityAt: new Date(), events: { create: { userId: ctx.user.id, action: 'REOPENED', fromValue: before.stage.name, toValue: stage.name, notes: input.notes ?? null } } }, include });
  await audit(ctx, { action: 'UPDATE', resource: 'opportunity', resourceId: id, before: { status: before.status }, after: { status: 'OPEN', stage: stage.name } });
  return toRow(o, await stalledDaysDefault());
}

export async function softDelete(ctx: Ctx, id: string): Promise<void> {
  const before = await prisma.opportunity.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw notFound('Oportunidade não encontrada');
  if (before.contractId) throw badRequest('Oportunidade formalizada em contrato não pode ser excluída');
  await prisma.opportunity.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit(ctx, { action: 'SOFT_DELETE', resource: 'opportunity', resourceId: id, before: { title: before.title, entityId: before.entityId, status: before.status } });
}

/**
 * Formalização: cria o contrato a partir da oportunidade GANHA. Por padrão nasce em RASCUNHO (status DRAFT);
 * só nasce ATIVO quando `activate` é true (confirmação explícita do usuário), e então pode criar o alarme de emissão.
 * A oportunidade guarda `contractId`; o contrato é dono do módulo Contratos/Financeiro.
 */
export async function formalize(ctx: Ctx, id: string, input: z.infer<typeof formalizeOpportunitySchema>): Promise<{ opportunity: OpportunityRow; contractId: string; status: string }> {
  const o = await prisma.opportunity.findFirst({ where: { id, deletedAt: null }, include });
  if (!o) throw notFound('Oportunidade não encontrada');
  if (o.status !== 'WON') throw badRequest('Só oportunidades ganhas podem ser formalizadas');
  if (o.contractId) throw badRequest('Esta oportunidade já gerou um contrato');
  const dup = await prisma.contract.findFirst({ where: { entityId: o.entityId, number: input.number, deletedAt: null }, select: { id: true } });
  if (dup) throw badRequest(`Já existe o contrato ${input.number} nesta entidade`);
  const contract = await createContract(ctx, {
    entityId: o.entityId, number: input.number, object: input.object ?? o.title, description: o.description ?? null,
    monthlyValue: input.monthlyValue ?? (o.monthlyAmount ? o.monthlyAmount.toFixed(2) : null), totalValue: input.totalValue ?? (o.totalAmount ? o.totalAmount.toFixed(2) : null),
    startDate: input.startDate ?? null, endDate: input.endDate ?? null, status: input.activate ? 'ACTIVE' : 'DRAFT', expectsMonthlyBilling: Boolean(o.monthlyAmount && o.monthlyAmount.gt(0)),
    responsibleUserId: input.responsibleUserId ?? o.ownerUserId ?? null, notes: input.notes ?? `Origem: oportunidade "${o.title}" (CRM)`,
  });
  if (input.activate && input.issuanceDay) {
    await createAlarm(ctx, { entityId: o.entityId, contractNumber: input.number, label: 'Emissão da nota', dayOfMonth: input.issuanceDay, leadDays: 5, notes: `Criado na formalização da oportunidade "${o.title}"` });
  }
  const updated = await prisma.opportunity.update({ where: { id }, data: { contractId: contract.id, lastActivityAt: new Date(), events: { create: { userId: ctx.user.id, action: 'FORMALIZED', toValue: `${input.number} (${input.activate ? 'ativo' : 'rascunho'})` } } }, include });
  await audit(ctx, { action: 'UPDATE', resource: 'opportunity', resourceId: id, after: { contractId: contract.id, status: contract.status } });
  return { opportunity: toRow(updated, await stalledDaysDefault()), contractId: contract.id, status: contract.status };
}

/** Oportunidades paradas da organização atual (para cron/alertas e dashboard). */
export async function stalled(): Promise<Array<Row & { daysInStage: number }>> {
  const fallback = await stalledDaysDefault();
  const rows = await prisma.opportunity.findMany({ where: { deletedAt: null, status: 'OPEN' }, include });
  const today = todayIso();
  return rows.filter((o) => isStalled(o, fallback, today)).map((o) => ({ ...o, daysInStage: daysBetween(o.stageEnteredAt.toISOString().slice(0, 10), today) }));
}
