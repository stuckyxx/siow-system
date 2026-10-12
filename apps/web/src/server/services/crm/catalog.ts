/** Catálogo de produtos e serviços (por organização). Exclusão lógica; itens inativos não aparecem para seleção. */
import { Prisma } from '@siow/db';
import type { CatalogItemRow } from '@siow/shared';
import type { z } from 'zod';
import type { catalogItemSchema, updateCatalogItemSchema } from '@siow/shared';
import { prisma } from '../../db.js';
import { currentOrgId } from '../../tenant.js';
import { audit } from '../../audit.js';
import { notFound, type Ctx } from '../../http.js';

const toRow = (c: { id: string; code: string | null; name: string; description: string | null; category: string | null; unitPrice: Prisma.Decimal; recurrence: string; isActive: boolean }): CatalogItemRow => ({ id: c.id, code: c.code, name: c.name, description: c.description, category: c.category, unitPrice: c.unitPrice.toFixed(2), recurrence: c.recurrence, isActive: c.isActive });

export async function list(onlyActive = false): Promise<CatalogItemRow[]> {
  const rows = await prisma.catalogItem.findMany({ where: { deletedAt: null, isActive: onlyActive ? true : undefined }, orderBy: [{ category: 'asc' }, { name: 'asc' }] });
  return rows.map(toRow);
}

export async function create(ctx: Ctx, input: z.infer<typeof catalogItemSchema>): Promise<CatalogItemRow> {
  const c = await prisma.catalogItem.create({ data: { organizationId: currentOrgId(), code: input.code ?? null, name: input.name, description: input.description ?? null, category: input.category ?? null, unitPrice: new Prisma.Decimal(input.unitPrice), recurrence: input.recurrence, isActive: input.isActive } });
  await audit(ctx, { action: 'CREATE', resource: 'catalogItem', resourceId: c.id, after: c });
  return toRow(c);
}

export async function update(ctx: Ctx, id: string, input: z.infer<typeof updateCatalogItemSchema>): Promise<CatalogItemRow> {
  const before = await prisma.catalogItem.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw notFound('Item do catálogo não encontrado');
  const c = await prisma.catalogItem.update({ where: { id }, data: { ...input, unitPrice: input.unitPrice !== undefined ? new Prisma.Decimal(input.unitPrice) : undefined } });
  await audit(ctx, { action: 'UPDATE', resource: 'catalogItem', resourceId: id, before, after: c });
  return toRow(c);
}

export async function remove(ctx: Ctx, id: string): Promise<void> {
  const before = await prisma.catalogItem.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw notFound('Item do catálogo não encontrado');
  await prisma.catalogItem.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  await audit(ctx, { action: 'SOFT_DELETE', resource: 'catalogItem', resourceId: id, before });
}
