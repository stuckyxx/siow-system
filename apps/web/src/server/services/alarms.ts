/**
 * Alarmes de emissão de nota (ficha da entidade → aba "Alarme").
 * Cada alarme guarda o dia do mês em que a nota deve ser emitida e a antecedência do aviso (padrão 5 dias).
 * O prazo é calculado sempre a partir de hoje: se neste mês já saiu nota da entidade, o alarme conta como
 * EMITIDO e o próximo prazo é o do mês seguinte; se o dia passou sem nota, fica ATRASADO; dentro da
 * antecedência fica A VENCER; o restante é PRÓXIMO. O cron diário gera uma notificação por alarme/competência.
 */
import { Prisma } from '@siow/db';
import { daysBetween, todayIso, type IssuanceAlarm, type IssuanceDeadline, type IssuanceDeadlineStatus } from '@siow/shared';
import type { z } from 'zod';
import type { createIssuanceAlarmSchema, updateIssuanceAlarmSchema } from '@siow/shared';
import { prisma } from '../db.js';
import { currentOrgId } from '../tenant.js';
import { audit } from '../audit.js';
import { badRequest, notFound, type Ctx } from '../http.js';

type AlarmRow = Prisma.IssuanceAlarmGetPayload<{ include: { entity: { select: { name: true; shortName: true } } } }>;
const include = { entity: { select: { name: true, shortName: true } } } as const;

function toAlarm(a: AlarmRow): IssuanceAlarm {
  return { id: a.id, entityId: a.entityId, entityName: a.entity.name, entityShortName: a.entity.shortName, contractNumber: a.contractNumber, label: a.label, dayOfMonth: a.dayOfMonth, leadDays: a.leadDays, isActive: a.isActive, notes: a.notes };
}

/** Data (YYYY-MM-DD) do dia `day` no mês `ym`, limitada ao último dia do mês (31 → 30/28). */
export function dateInMonth(ym: string, day: number): string {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ym}-${String(Math.min(day, last)).padStart(2, '0')}`;
}
const nextMonth = (ym: string): string => { const [y, m] = ym.split('-').map(Number) as [number, number]; return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };

export async function list(entityId?: string): Promise<IssuanceAlarm[]> {
  const rows = await prisma.issuanceAlarm.findMany({ where: { deletedAt: null, entityId }, include, orderBy: [{ entity: { name: 'asc' } }, { dayOfMonth: 'asc' }] });
  return rows.map(toAlarm);
}

export async function create(ctx: Ctx, dto: z.infer<typeof createIssuanceAlarmSchema>): Promise<IssuanceAlarm> {
  const entity = await prisma.entity.findFirst({ where: { id: dto.entityId, deletedAt: null }, select: { id: true } });
  if (!entity) throw notFound('Entidade não encontrada');
  const row = await prisma.issuanceAlarm.create({ data: { ...dto, organizationId: currentOrgId(), createdByUserId: ctx.user.id }, include });
  await audit(ctx, { action: 'CREATE', resource: 'issuanceAlarm', resourceId: row.id, after: row });
  return toAlarm(row);
}

export async function update(ctx: Ctx, id: string, dto: z.infer<typeof updateIssuanceAlarmSchema>): Promise<IssuanceAlarm> {
  const before = await prisma.issuanceAlarm.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw notFound('Alarme não encontrado');
  if (Object.keys(dto).length === 0) throw badRequest('Nenhuma alteração informada');
  const row = await prisma.issuanceAlarm.update({ where: { id }, data: dto, include });
  await audit(ctx, { action: 'UPDATE', resource: 'issuanceAlarm', resourceId: id, before, after: row });
  return toAlarm(row);
}

export async function remove(ctx: Ctx, id: string): Promise<void> {
  const before = await prisma.issuanceAlarm.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw notFound('Alarme não encontrado');
  await prisma.issuanceAlarm.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  await audit(ctx, { action: 'SOFT_DELETE', resource: 'issuanceAlarm', resourceId: id, before });
}

/**
 * Prazos calculados para os alarmes ativos. `days` limita os PRÓXIMOS (atrasados, a vencer e emitidos do mês
 * sempre entram). Ordenado: atrasados, a vencer, próximos, emitidos.
 */
export async function deadlines(opts: { entityId?: string; days?: number; today?: string } = {}): Promise<IssuanceDeadline[]> {
  const today = opts.today ?? todayIso();
  const horizon = opts.days ?? 30;
  const ym = today.slice(0, 7);
  const alarms = await prisma.issuanceAlarm.findMany({ where: { deletedAt: null, isActive: true, entityId: opts.entityId, entity: { deletedAt: null } }, include });
  if (alarms.length === 0) return [];
  // notas emitidas no mês corrente e no seguinte, por entidade (uma consulta só)
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m + 1, 1));
  const invoices = await prisma.invoice.findMany({
    where: { deletedAt: null, status: { not: 'CANCELLED' }, entityId: { in: [...new Set(alarms.map((a) => a.entityId))] }, issueDate: { gte: from, lt: to } },
    select: { entityId: true, number: true, issueDate: true, contract: { select: { number: true } } },
    orderBy: { issueDate: 'desc' },
  });
  const issued = (entityId: string, month: string, contractNumber: string | null) =>
    invoices.find((i) => i.entityId === entityId && i.issueDate!.toISOString().slice(0, 7) === month && (!contractNumber || !i.contract?.number || i.contract.number === contractNumber)) ?? null;

  const out: IssuanceDeadline[] = [];
  for (const a of alarms) {
    let competence = ym;
    let dueDate = dateInMonth(ym, a.dayOfMonth);
    let inv = issued(a.entityId, ym, a.contractNumber);
    let status: IssuanceDeadlineStatus;
    if (inv) {
      status = 'ISSUED';
    } else {
      const d = daysBetween(today, dueDate);
      status = d < 0 ? 'LATE' : d <= a.leadDays ? 'DUE' : 'UPCOMING';
    }
    if (status === 'ISSUED') {
      // já emitida: mostra como cumprida e também projeta o mês seguinte se ele já estiver no horizonte
      out.push({ ...toAlarm(a), dueDate, competence, daysUntil: daysBetween(today, dueDate), status, issuedInvoiceNumber: inv!.number, issuedAt: inv!.issueDate!.toISOString().slice(0, 10) });
      competence = nextMonth(ym); dueDate = dateInMonth(competence, a.dayOfMonth); inv = issued(a.entityId, competence, a.contractNumber);
      const d = daysBetween(today, dueDate);
      if (inv) continue;
      if (d <= horizon) out.push({ ...toAlarm(a), dueDate, competence, daysUntil: d, status: d <= a.leadDays ? 'DUE' : 'UPCOMING', issuedInvoiceNumber: null, issuedAt: null });
      continue;
    }
    const d = daysBetween(today, dueDate);
    if (status === 'UPCOMING' && d > horizon) continue;
    out.push({ ...toAlarm(a), dueDate, competence, daysUntil: d, status, issuedInvoiceNumber: null, issuedAt: null });
  }
  const rank: Record<IssuanceDeadlineStatus, number> = { LATE: 0, DUE: 1, UPCOMING: 2, ISSUED: 3 };
  return out.sort((x, y2) => rank[x.status] - rank[y2.status] || x.daysUntil - y2.daysUntil || x.entityName.localeCompare(y2.entityName));
}

/** Cron diário: uma notificação por alarme/competência quando entra na antecedência ou atrasa. */
export async function notifyDue(today = todayIso()): Promise<{ due: number; late: number }> {
  const items = (await deadlines({ today, days: 0 })).filter((d) => d.status === 'DUE' || d.status === 'LATE');
  let due = 0; let late = 0;
  for (const d of items) {
    if (d.status === 'LATE') late += 1; else due += 1;
    const name = d.entityShortName ?? d.entityName;
    const when = d.dueDate.split('-').reverse().join('/');
    await prisma.notification.upsert({
      where: { dedupeKey: `ISSUANCE_DUE:${d.id}:${d.competence}` },
      update: {},
      create: {
        organizationId: currentOrgId(),
        type: 'ISSUANCE_DUE',
        title: d.status === 'LATE' ? `Nota em atraso: ${name} (dia ${d.dayOfMonth})` : `Emitir nota de ${name} até ${when}`,
        body: `${d.label}${d.contractNumber ? ` · contrato ${d.contractNumber}` : ''} · competência ${d.competence.split('-').reverse().join('/')}${d.status === 'LATE' ? ` · ${-d.daysUntil} dia(s) de atraso` : ` · faltam ${d.daysUntil} dia(s)`}`,
        entityId: d.entityId,
        referenceType: 'issuanceAlarm',
        referenceId: d.id,
        dedupeKey: `ISSUANCE_DUE:${d.id}:${d.competence}`,
      },
    });
  }
  return { due, late };
}
