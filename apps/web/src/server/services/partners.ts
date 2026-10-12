/**
 * Parceiros (módulo 7): cadastro, vínculo com entidades (entities.partnerId), extrato consolidado.
 * O portal do parceiro (papel PARCEIRO) só enxerga o parceiro ligado ao próprio usuário (`Partner.userId`).
 */
import { Prisma } from '@siow/db';
import type { PartnerRow, PartnerStatement } from '@siow/shared';
import type { z } from 'zod';
import type { linkPartnerEntitiesSchema, partnerSchema, updatePartnerSchema } from '@siow/shared';
import { prisma } from '../db.js';
import { currentOrgId } from '../tenant.js';
import { audit } from '../audit.js';
import { badRequest, forbidden, notFound, type Ctx } from '../http.js';

const include = { user: { select: { name: true } }, _count: { select: { entities: true, contracts: true, opportunities: true, rules: { where: { isActive: true } } } } } satisfies Prisma.PartnerInclude;
type Row = Prisma.PartnerGetPayload<{ include: typeof include }>;

async function totalsFor(ids: string[]): Promise<Map<string, PartnerRow['totals']>> {
  const out = new Map<string, PartnerRow['totals']>();
  if (!ids.length) return out;
  const groups = await prisma.commission.groupBy({ by: ['partnerId', 'status'], where: { partnerId: { in: ids } }, _sum: { amount: true } });
  for (const id of ids) out.set(id, { forecast: '0.00', due: '0.00', paid: '0.00', reversed: '0.00' });
  for (const g of groups) {
    const t = out.get(g.partnerId)!;
    const v = (g._sum.amount ?? new Prisma.Decimal(0)).toFixed(2);
    if (g.status === 'FORECAST') t.forecast = v; else if (g.status === 'DUE') t.due = v; else if (g.status === 'PAID') t.paid = v; else if (g.status === 'REVERSED') t.reversed = v;
  }
  return out;
}

async function toRows(rows: Row[]): Promise<PartnerRow[]> {
  const totals = await totalsFor(rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id, name: r.name, kind: r.kind, document: r.document, contactName: r.contactName, email: r.email, phone: r.phone, whatsapp: r.whatsapp,
    userId: r.userId, userName: r.user?.name ?? null, bankInfo: r.bankInfo, notes: r.notes, isActive: r.isActive,
    entityCount: r._count.entities, contractCount: r._count.contracts, opportunityCount: r._count.opportunities, ruleCount: r._count.rules,
    totals: totals.get(r.id) ?? { forecast: '0.00', due: '0.00', paid: '0.00', reversed: '0.00' },
  }));
}

export async function list(q?: string): Promise<PartnerRow[]> {
  const rows = await prisma.partner.findMany({ where: { deletedAt: null, name: q ? { contains: q, mode: 'insensitive' } : undefined }, include, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
  return toRows(rows);
}

export async function get(id: string): Promise<PartnerRow> {
  const p = await prisma.partner.findFirst({ where: { id, deletedAt: null }, include });
  if (!p) throw notFound('Parceiro não encontrado');
  return (await toRows([p]))[0]!;
}

/** Parceiro ligado ao usuário atual (portal). */
export async function mine(ctx: Ctx): Promise<PartnerRow> {
  const p = await prisma.partner.findFirst({ where: { userId: ctx.user.id, deletedAt: null }, include });
  if (!p) throw forbidden('Seu usuário não está vinculado a um parceiro');
  return (await toRows([p]))[0]!;
}

export async function create(ctx: Ctx, input: z.infer<typeof partnerSchema>): Promise<PartnerRow> {
  if (input.userId) { const u = await prisma.user.findFirst({ where: { id: input.userId, deletedAt: null } }); if (!u) throw badRequest('Usuário não encontrado'); }
  const p = await prisma.partner.create({ data: { organizationId: currentOrgId(), ...input, email: input.email || null }, include });
  await audit(ctx, { action: 'CREATE', resource: 'partner', resourceId: p.id, after: { name: p.name, kind: p.kind } });
  return (await toRows([p]))[0]!;
}

export async function update(ctx: Ctx, id: string, input: z.infer<typeof updatePartnerSchema>): Promise<PartnerRow> {
  const before = await prisma.partner.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw notFound('Parceiro não encontrado');
  const p = await prisma.partner.update({ where: { id }, data: { ...input, email: input.email === undefined ? undefined : input.email || null }, include });
  await audit(ctx, { action: 'UPDATE', resource: 'partner', resourceId: id, before, after: p });
  return (await toRows([p]))[0]!;
}

/** Exclusão lógica; comissões ficam registradas. Parceiro com comissões a pagar não pode ser excluído. */
export async function remove(ctx: Ctx, id: string): Promise<void> {
  const before = await prisma.partner.findFirst({ where: { id, deletedAt: null }, include: { _count: { select: { commissions: { where: { status: 'DUE' } } } } } });
  if (!before) throw notFound('Parceiro não encontrado');
  if (before._count.commissions) throw badRequest('Parceiro com comissões a pagar: quite ou estorne antes de excluir');
  await prisma.$transaction([
    prisma.entity.updateMany({ where: { partnerId: id }, data: { partnerId: null } }),
    prisma.commissionRule.updateMany({ where: { partnerId: id }, data: { isActive: false } }),
    prisma.partner.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } }),
  ]);
  await audit(ctx, { action: 'SOFT_DELETE', resource: 'partner', resourceId: id, before: { name: before.name } });
}

/** Vincula/desvincula entidades ao parceiro (uma entidade tem no máximo um parceiro). */
export async function linkEntities(ctx: Ctx, id: string, input: z.infer<typeof linkPartnerEntitiesSchema>): Promise<{ updated: number }> {
  await get(id);
  const r = input.unlink
    ? await prisma.entity.updateMany({ where: { id: { in: input.entityIds }, partnerId: id }, data: { partnerId: null } })
    : await prisma.entity.updateMany({ where: { id: { in: input.entityIds }, deletedAt: null }, data: { partnerId: id } });
  await audit(ctx, { action: input.unlink ? 'PARTNER_UNLINK' : 'PARTNER_LINK', resource: 'partner', resourceId: id, after: { entityIds: input.entityIds, updated: r.count } });
  return { updated: r.count };
}

/** Extrato do parceiro: totais por situação, por competência, entidades e oportunidades vinculadas. */
export async function statement(id: string): Promise<PartnerStatement> {
  const partner = await get(id);
  const [commissions, entities, opportunities] = await Promise.all([
    prisma.commission.findMany({ where: { partnerId: id }, select: { status: true, amount: true, competenceYear: true, competenceMonth: true } }),
    prisma.entity.findMany({ where: { partnerId: id, deletedAt: null }, select: { id: true, name: true, shortName: true, municipality: true, uf: true, contracts: { where: { deletedAt: null, status: 'ACTIVE' }, select: { number: true }, take: 1 } }, orderBy: { name: 'asc' } }),
    prisma.opportunity.findMany({ where: { OR: [{ partnerId: id }, { entity: { partnerId: id } }], deletedAt: null }, select: { id: true, title: true, status: true, totalAmount: true, stage: { select: { name: true } }, entity: { select: { name: true, shortName: true } } }, orderBy: { updatedAt: 'desc' }, take: 50 }),
  ]);
  const months = new Map<string, { forecast: Prisma.Decimal; due: Prisma.Decimal; paid: Prisma.Decimal }>();
  let dueCount = 0;
  for (const c of commissions) {
    const k = `${c.competenceYear}-${String(c.competenceMonth).padStart(2, '0')}`;
    const m = months.get(k) ?? { forecast: new Prisma.Decimal(0), due: new Prisma.Decimal(0), paid: new Prisma.Decimal(0) };
    if (c.status === 'FORECAST') m.forecast = m.forecast.add(c.amount); else if (c.status === 'DUE') { m.due = m.due.add(c.amount); dueCount += 1; } else if (c.status === 'PAID') m.paid = m.paid.add(c.amount);
    months.set(k, m);
  }
  return {
    partner,
    totals: { ...partner.totals, dueCount },
    byMonth: [...months.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([competence, m]) => ({ competence, forecast: m.forecast.toFixed(2), due: m.due.toFixed(2), paid: m.paid.toFixed(2) })),
    entities: entities.map((e) => ({ id: e.id, name: e.name, shortName: e.shortName, municipality: e.municipality, uf: e.uf, activeContract: e.contracts[0]?.number ?? null })),
    opportunities: opportunities.map((o) => ({ id: o.id, title: o.title, status: o.status, stageName: o.stage.name, totalAmount: o.totalAmount ? o.totalAmount.toFixed(2) : null, entityName: o.entity.shortName ?? o.entity.name })),
  };
}
