/** Agentes públicos (prefeito, presidente da câmara, secretários…) — Cadastro Público. Dados pessoais: permissões de contatos. */
import { dateToIso, isoToDate, type PublicAgent } from '@siow/shared';
import type { z } from 'zod';
import type { createPublicAgentSchema, updatePublicAgentSchema } from '@siow/shared';
import { prisma } from '../db.js';
import { audit } from '../audit.js';
import { notFound, type Ctx } from '../http.js';
import { currentOrgId } from '../tenant.js';

type Row = NonNullable<Awaited<ReturnType<typeof prisma.publicAgent.findFirst>>>;
const toView = (a: Row): PublicAgent => ({ id: a.id, entityId: a.entityId, name: a.name, position: a.position, party: a.party, termStart: dateToIso(a.termStart), termEnd: dateToIso(a.termEnd), email: a.email, phone: a.phone, whatsapp: a.whatsapp, isDecisionMaker: a.isDecisionMaker, isActive: a.isActive, notes: a.notes });
const dates = (d: { termStart?: string | null; termEnd?: string | null }) => ({ termStart: d.termStart === undefined ? undefined : d.termStart ? isoToDate(d.termStart) : null, termEnd: d.termEnd === undefined ? undefined : d.termEnd ? isoToDate(d.termEnd) : null });

export async function list(entityId: string): Promise<PublicAgent[]> {
  const rows = await prisma.publicAgent.findMany({ where: { entityId, deletedAt: null }, orderBy: [{ isDecisionMaker: 'desc' }, { isActive: 'desc' }, { name: 'asc' }] });
  return rows.map(toView);
}
export async function create(ctx: Ctx, entityId: string, dto: z.infer<typeof createPublicAgentSchema>): Promise<PublicAgent> {
  const e = await prisma.entity.findFirst({ where: { id: entityId, deletedAt: null }, select: { id: true } });
  if (!e) throw notFound('Entidade não encontrada');
  const row = await prisma.publicAgent.create({ data: { ...dto, ...dates(dto), organizationId: currentOrgId(), entityId } });
  await audit(ctx, { action: 'CREATE', resource: 'publicAgent', resourceId: row.id, after: row });
  return toView(row);
}
export async function update(ctx: Ctx, entityId: string, id: string, dto: z.infer<typeof updatePublicAgentSchema>): Promise<PublicAgent> {
  const before = await prisma.publicAgent.findFirst({ where: { id, entityId, deletedAt: null } });
  if (!before) throw notFound('Agente público não encontrado');
  const row = await prisma.publicAgent.update({ where: { id }, data: { ...dto, ...dates(dto) } });
  await audit(ctx, { action: 'UPDATE', resource: 'publicAgent', resourceId: id, before, after: row });
  return toView(row);
}
export async function remove(ctx: Ctx, entityId: string, id: string): Promise<void> {
  const before = await prisma.publicAgent.findFirst({ where: { id, entityId, deletedAt: null } });
  if (!before) throw notFound('Agente público não encontrado');
  await prisma.publicAgent.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  await audit(ctx, { action: 'SOFT_DELETE', resource: 'publicAgent', resourceId: id, before });
}
