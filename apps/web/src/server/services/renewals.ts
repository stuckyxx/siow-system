/**
 * Renovações de contrato (Fase 3): o cron abre a renovação quando a vigência entra na janela
 * (`contracts.renewalDays`, padrão 90), criando — uma única vez por contrato/vigência — a oportunidade
 * (origem RENOVACAO) no funil padrão e a tarefa RENEWAL na agenda única. A decisão (renovado / não renovado)
 * é sempre humana: nenhum aditivo é formalizado automaticamente.
 */
import type { Prisma } from '@siow/db';
import { addDaysIso, dateToIso, daysBetween, isoToDate, todayIso, type ContractRenewalRow } from '@siow/shared';
import type { z } from 'zod';
import type { renewalDecisionSchema, renewalListFilterSchema } from '@siow/shared';
import { prisma } from '../db.js';
import { currentOrgId } from '../tenant.js';
import { audit } from '../audit.js';
import { badRequest, notFound, type Ctx } from '../http.js';
import { ensureDefault } from './crm/pipelines.js';

async function renewalDays(): Promise<number> {
  const s = await prisma.setting.findUnique({ where: { key: 'contracts.renewalDays' } });
  return typeof s?.value === 'number' && s.value > 0 ? s.value : 90;
}

/** Abre renovações para contratos ativos cuja vigência termina dentro da janela. Idempotente (unique contractId+endDate). */
export async function detectRenewals(today = todayIso()): Promise<{ checked: number; created: number }> {
  const days = await renewalDays();
  const contracts = await prisma.contract.findMany({
    where: { deletedAt: null, status: 'ACTIVE', endDate: { not: null, gte: isoToDate(today), lte: isoToDate(addDaysIso(today, days)) } },
    include: { entity: { select: { id: true, name: true, shortName: true } }, renewals: { select: { endDate: true } }, invoices: { where: { deletedAt: null, status: { not: 'CANCELLED' }, issueDate: { not: null } }, orderBy: { issueDate: 'desc' }, take: 1, select: { amount: true } } },
  });
  let created = 0;
  for (const c of contracts) {
    const end = c.endDate!;
    if (c.renewals.some((r) => r.endDate.getTime() === end.getTime())) continue;
    const notice = c.renewalNoticeDays ?? days;
    if (daysBetween(today, dateToIso(end)!) > notice) continue;
    const pipeline = await ensureDefault();
    const stage = pipeline.stages.find((s) => s.kind === 'OPEN');
    if (!stage) continue;
    const org = currentOrgId();
    // Valor mensal: do contrato; contratos lidos do portal não têm valor, então usa a última nota emitida (mesma regra do Dashboard).
    const monthly = c.monthlyValue ?? c.invoices[0]?.amount ?? null;
    await prisma.$transaction(async (tx) => {
      const opp = await tx.opportunity.create({
        data: {
          organizationId: org, entityId: c.entityId, pipelineId: pipeline.id, stageId: stage.id, title: `Renovação do contrato ${c.number}`,
          description: `Renovação gerada automaticamente: vigência termina em ${dateToIso(end)!.split('-').reverse().join('/')}.${c.object ? ` Objeto: ${c.object}` : ''}`,
          monthlyAmount: monthly, termMonths: 12, totalAmount: monthly ? monthly.mul(12) : null, expectedCloseDate: end, source: 'RENOVACAO',
          ownerUserId: c.responsibleUserId, lastActivityAt: new Date(), events: { create: { action: 'CREATED', toValue: `${stage.name} (renovação automática)` } },
        },
      });
      const due = addDaysIso(dateToIso(end)!, -30);
      const task = await tx.financialTask.create({
        data: {
          organizationId: org, title: `Tratar renovação do contrato ${c.number} — ${c.entity.shortName ?? c.entity.name}`, type: 'RENEWAL', module: 'CONTRATOS', entityId: c.entityId, contractId: c.id, opportunityId: opp.id,
          assigneeUserId: c.responsibleUserId, priority: 'HIGH', dueDate: isoToDate(due < today ? today : due), description: 'Decidir renovação (aditivo de prorrogação ou novo contrato) ou registrar o não-renovação.',
          events: { create: { action: 'CREATED' } },
        },
      });
      await tx.contractRenewal.create({ data: { organizationId: org, contractId: c.id, endDate: end, opportunityId: opp.id, taskId: task.id } });
    });
    created += 1;
  }
  return { checked: contracts.length, created };
}

const include = { contract: { select: { number: true, monthlyValue: true, entity: { select: { id: true, name: true, shortName: true } } } } } satisfies Prisma.ContractRenewalInclude;

async function toRows(rows: Array<Prisma.ContractRenewalGetPayload<{ include: typeof include }>>): Promise<ContractRenewalRow[]> {
  const today = todayIso();
  const oppIds = rows.map((r) => r.opportunityId).filter(Boolean) as string[];
  const taskIds = rows.map((r) => r.taskId).filter(Boolean) as string[];
  const userIds = rows.map((r) => r.decidedByUserId).filter(Boolean) as string[];
  const [opps, tasks, users] = await Promise.all([
    oppIds.length ? prisma.opportunity.findMany({ where: { id: { in: oppIds } }, select: { id: true, status: true, monthlyAmount: true } }) : [],
    taskIds.length ? prisma.financialTask.findMany({ where: { id: { in: taskIds } }, select: { id: true, status: true } }) : [],
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
  ]);
  const o = new Map(opps.map((x) => [x.id, x.status])); const om = new Map(opps.map((x) => [x.id, x.monthlyAmount])); const t = new Map(tasks.map((x) => [x.id, x.status])); const u = new Map(users.map((x) => [x.id, x.name]));
  return rows.map((r) => ({
    id: r.id, contractId: r.contractId, contractNumber: r.contract.number, endDate: dateToIso(r.endDate)!, status: r.status, daysToEnd: daysBetween(today, dateToIso(r.endDate)!),
    entity: r.contract.entity, monthlyValue: (r.contract.monthlyValue ?? (r.opportunityId ? om.get(r.opportunityId) : null))?.toFixed(2) ?? null,
    opportunityId: r.opportunityId, opportunityStatus: r.opportunityId ? o.get(r.opportunityId) ?? null : null, taskId: r.taskId, taskStatus: r.taskId ? t.get(r.taskId) ?? null : null,
    amendmentId: r.amendmentId, newContractId: r.newContractId, notes: r.notes, decidedAt: r.decidedAt?.toISOString() ?? null, decidedBy: r.decidedByUserId ? u.get(r.decidedByUserId) ?? null : null, createdAt: r.createdAt.toISOString(),
  }));
}

export async function list(f: z.infer<typeof renewalListFilterSchema>): Promise<ContractRenewalRow[]> {
  const rows = await prisma.contractRenewal.findMany({ where: { status: f.status, contract: f.entityId ? { entityId: f.entityId } : undefined }, include, orderBy: [{ status: 'asc' }, { endDate: 'asc' }] });
  return toRows(rows);
}

/** Decisão humana da renovação. RENEWED fecha a oportunidade como ganha (mesmo contrato) e conclui a tarefa; NOT_RENEWED marca perdida e cancela a tarefa. */
export async function decide(ctx: Ctx, id: string, input: z.infer<typeof renewalDecisionSchema>): Promise<ContractRenewalRow> {
  const r = await prisma.contractRenewal.findFirst({ where: { id }, include });
  if (!r) throw notFound('Renovação não encontrada');
  if (r.status !== 'OPEN') throw badRequest('Renovação já decidida');
  if (input.amendmentId) { const a = await prisma.contractAmendment.findFirst({ where: { id: input.amendmentId, contractId: r.contractId } }); if (!a) throw badRequest('Aditivo não pertence a este contrato'); }
  if (input.newContractId) { const c = await prisma.contract.findFirst({ where: { id: input.newContractId, deletedAt: null } }); if (!c) throw badRequest('Novo contrato não encontrado'); }
  await prisma.$transaction(async (tx) => {
    await tx.contractRenewal.update({ where: { id }, data: { status: input.status, amendmentId: input.amendmentId ?? null, newContractId: input.newContractId ?? null, notes: input.notes ?? null, decidedAt: new Date(), decidedByUserId: ctx.user.id } });
    if (r.opportunityId) {
      const opp = await tx.opportunity.findFirst({ where: { id: r.opportunityId, deletedAt: null }, include: { pipeline: { include: { stages: true } } } });
      if (opp && opp.status === 'OPEN') {
        const stage = opp.pipeline.stages.find((s) => s.kind === (input.status === 'RENEWED' ? 'WON' : 'LOST'));
        if (stage) await tx.opportunity.update({ where: { id: opp.id }, data: input.status === 'RENEWED'
          ? { status: 'WON', stageId: stage.id, stageEnteredAt: new Date(), wonAt: new Date(), contractId: input.newContractId ?? r.contractId, lastActivityAt: new Date(), events: { create: { userId: ctx.user.id, action: 'WON', toValue: 'Renovação confirmada', notes: input.notes ?? null } } }
          : { status: 'LOST', stageId: stage.id, stageEnteredAt: new Date(), lostAt: new Date(), lostReason: input.status === 'NOT_RENEWED' ? 'Não renovado' : 'Renovação cancelada', lostNotes: input.notes ?? null, lastActivityAt: new Date(), events: { create: { userId: ctx.user.id, action: 'LOST', toValue: input.status === 'NOT_RENEWED' ? 'Não renovado' : 'Cancelada', notes: input.notes ?? null } } } });
      }
    }
    if (r.taskId) await tx.financialTask.updateMany({ where: { id: r.taskId, status: { in: ['PENDING', 'IN_PROGRESS'] } }, data: { status: input.status === 'RENEWED' ? 'DONE' : 'CANCELLED', completedAt: input.status === 'RENEWED' ? new Date() : null } });
  });
  await audit(ctx, { action: 'RENEWAL_DECIDED', resource: 'contract', resourceId: r.contractId, before: { renewal: id, status: 'OPEN' }, after: { status: input.status, amendmentId: input.amendmentId ?? null, newContractId: input.newContractId ?? null }, justification: input.notes ?? undefined });
  const after = await prisma.contractRenewal.findFirst({ where: { id }, include });
  return (await toRows([after!]))[0]!;
}
