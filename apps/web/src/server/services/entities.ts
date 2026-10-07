/**
 * Entidades (prefeituras/câmaras), fontes de dados, contatos e importação em lote.
 */
import ExcelJS from 'exceljs';
import { Prisma } from '@siow/db';
import { dateToIso, importEntityRowSchema, type EntitySummary, type ImportEntityRow, type Paginated } from '@siow/shared';
import type { z } from 'zod';
import type { createContactSchema, createDataSourceSchema, createEntitySchema, entityListFilterSchema, updateContactSchema, updateDataSourceSchema, updateEntitySchema } from '@siow/shared';
import { prisma } from '../db.js';
import { audit } from '../audit.js';
import { badRequest, notFound, type Ctx } from '../http.js';

type EntityFilter = z.infer<typeof entityListFilterSchema>;

const SORTABLE: Record<string, string> = {
  name: 'e.name',
  municipality: 'e.municipality',
  type: 'e.type',
  debtTotal: 'debt_total',
  pendingInvoices: 'pending_count',
  lastPaymentAt: 'last_payment_at',
  lastSyncAt: 'last_sync_at',
};

/**
 * Listagem com indicadores financeiros agregados (débito, pendentes, último
 * pagamento, OS, cobrança, sync). Uma query SQL com subconsultas para manter
 * paginação/ordenação eficientes mesmo com centenas de entidades.
 */
export async function list(f: EntityFilter, onlyId?: string): Promise<Paginated<EntitySummary>> {
  const conds: Prisma.Sql[] = [Prisma.sql`e."deletedAt" IS NULL`];
  if (onlyId) conds.push(Prisma.sql`e.id = ${onlyId}`);
  if (f.q) {
    const like = `%${f.q}%`;
    conds.push(Prisma.sql`(
      e.name ILIKE ${like} OR e."shortName" ILIKE ${like} OR e.municipality ILIKE ${like}
      OR EXISTS (SELECT 1 FROM contracts c WHERE c."entityId" = e.id AND c.number ILIKE ${like})
      OR EXISTS (SELECT 1 FROM invoices i WHERE i."entityId" = e.id AND i.number ILIKE ${like})
    )`);
  }
  if (f.type) conds.push(Prisma.sql`e.type = ${f.type}::"EntityType"`);
  if (f.uf) conds.push(Prisma.sql`e.uf = ${f.uf.toUpperCase()}`);
  if (f.municipality) conds.push(Prisma.sql`e.municipality ILIKE ${f.municipality}`);
  if (f.responsibleUserId) conds.push(Prisma.sql`e."responsibleUserId" = ${f.responsibleUserId}`);
  if (f.isActive !== undefined) conds.push(Prisma.sql`e."isActive" = ${f.isActive}`);
  if (f.onlyWithDebt) conds.push(Prisma.sql`EXISTS (SELECT 1 FROM invoices i WHERE i."entityId" = e.id AND i.status = 'PENDING' AND i."deletedAt" IS NULL)`);
  const where = Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}`;
  const orderCol = SORTABLE[f.sortBy ?? ''] ?? 'e.name';
  const orderDir = f.sortDir === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const order = Prisma.sql`ORDER BY ${Prisma.raw(orderCol)} ${orderDir} NULLS LAST, e.name ASC`;

  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT e.id, e.type, e.name, e."shortName", e.municipality, e.uf, e."isActive",
      (SELECT c.number FROM contracts c WHERE c."entityId" = e.id AND c."deletedAt" IS NULL AND c.status = 'ACTIVE' ORDER BY c."endDate" DESC NULLS LAST LIMIT 1) AS active_contract_number,
      (SELECT c."endDate" FROM contracts c WHERE c."entityId" = e.id AND c."deletedAt" IS NULL AND c.status = 'ACTIVE' ORDER BY c."endDate" DESC NULLS LAST LIMIT 1) AS active_contract_end,
      COALESCE((SELECT SUM(i.amount) FROM invoices i WHERE i."entityId" = e.id AND i.status = 'PENDING' AND i."deletedAt" IS NULL), 0) AS debt_total,
      (SELECT COUNT(*) FROM invoices i WHERE i."entityId" = e.id AND i.status = 'PENDING' AND i."deletedAt" IS NULL)::int AS pending_count,
      (SELECT COUNT(*) FROM invoices i WHERE i."entityId" = e.id AND i."needsReconciliation" AND i."deletedAt" IS NULL)::int AS reconciliation_count,
      (SELECT i."paidAt" FROM invoices i WHERE i."entityId" = e.id AND i.status = 'PAID' AND i."deletedAt" IS NULL ORDER BY i."paidAt" DESC NULLS LAST LIMIT 1) AS last_payment_at,
      (SELECT COALESCE(i."paidAmount", i.amount) FROM invoices i WHERE i."entityId" = e.id AND i.status = 'PAID' AND i."deletedAt" IS NULL ORDER BY i."paidAt" DESC NULLS LAST LIMIT 1) AS last_payment_amount,
      (SELECT MAX(a."performedAt") FROM collection_attempts a JOIN collection_cases cc ON cc.id = a."caseId" WHERE cc."entityId" = e.id) AS last_collection_at,
      (SELECT cc.status FROM collection_cases cc WHERE cc."entityId" = e.id ORDER BY cc."updatedAt" DESC LIMIT 1) AS collection_status,
      (SELECT COUNT(*) FROM service_orders so WHERE so."entityId" = e.id AND so."deletedAt" IS NULL AND so.status NOT IN ('SIGNED','CANCELLED'))::int AS pending_service_orders,
      (SELECT MAX(ds."lastSyncAt") FROM data_sources ds WHERE ds."entityId" = e.id AND ds."deletedAt" IS NULL) AS last_sync_at,
      (SELECT ds."lastSyncStatus" FROM data_sources ds WHERE ds."entityId" = e.id AND ds."deletedAt" IS NULL ORDER BY ds."lastSyncAt" DESC NULLS LAST LIMIT 1) AS last_sync_status
    FROM entities e
    ${where}
    ${order}
    LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}
  `);
  const countRows = await prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`SELECT COUNT(*)::int AS count FROM entities e ${where}`);
  const count = countRows[0]?.count ?? 0;

  const items: EntitySummary[] = rows.map((r) => ({
    id: r['id'] as string,
    type: r['type'] as EntitySummary['type'],
    name: r['name'] as string,
    shortName: (r['shortName'] as string | null) ?? null,
    municipality: r['municipality'] as string,
    uf: r['uf'] as string,
    isActive: r['isActive'] as boolean,
    activeContractNumber: (r['active_contract_number'] as string | null) ?? null,
    activeContractEndDate: dateToIso(r['active_contract_end'] as Date | null),
    debtTotal: String(r['debt_total'] ?? '0'),
    pendingInvoices: Number(r['pending_count'] ?? 0),
    lastPaymentAt: dateToIso(r['last_payment_at'] as Date | null),
    lastPaymentAmount: r['last_payment_amount'] === null || r['last_payment_amount'] === undefined ? null : String(r['last_payment_amount']),
    lastCollectionAt: r['last_collection_at'] ? (r['last_collection_at'] as Date).toISOString() : null,
    collectionStatus: (r['collection_status'] as EntitySummary['collectionStatus']) ?? null,
    pendingServiceOrders: Number(r['pending_service_orders'] ?? 0),
    lastSyncAt: r['last_sync_at'] ? (r['last_sync_at'] as Date).toISOString() : null,
    lastSyncStatus: (r['last_sync_status'] as EntitySummary['lastSyncStatus']) ?? null,
    needsReconciliation: Number(r['reconciliation_count'] ?? 0),
  }));
  return { items, total: count, page: f.page, pageSize: f.pageSize };
}

export async function get(id: string) {
  const entity = await prisma.entity.findFirst({
    where: { id, deletedAt: null },
    include: {
      dataSources: { where: { deletedAt: null } },
      responsibleUser: { select: { id: true, name: true } },
      contracts: { where: { deletedAt: null }, include: { amendments: { orderBy: { sequence: 'asc' } } }, orderBy: { startDate: 'desc' } },
      _count: { select: { invoices: true, tasks: true, serviceOrders: true } },
    },
  });
  if (!entity) throw notFound('Entidade não encontrada');
  const overview = (await list({ page: 1, pageSize: 1, sortDir: 'desc' }, id)).items[0] ?? null;
  return { ...entity, overview };
}

export async function create(ctx: Ctx, input: z.infer<typeof createEntitySchema>) {
  const entity = await prisma.entity.create({ data: { ...input, uf: input.uf.toUpperCase() } });
  await audit(ctx, { action: 'CREATE', resource: 'entity', resourceId: entity.id, after: entity });
  return entity;
}

export async function update(ctx: Ctx, id: string, input: z.infer<typeof updateEntitySchema>) {
  const before = await prisma.entity.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw notFound('Entidade não encontrada');
  const after = await prisma.entity.update({ where: { id }, data: { ...input, uf: input.uf?.toUpperCase() } });
  await audit(ctx, { action: 'UPDATE', resource: 'entity', resourceId: id, before, after });
  return after;
}

export async function softDelete(ctx: Ctx, id: string): Promise<void> {
  const before = await prisma.entity.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw notFound('Entidade não encontrada');
  await prisma.entity.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  await audit(ctx, { action: 'SOFT_DELETE', resource: 'entity', resourceId: id, before });
}

async function ensureEntity(id: string): Promise<void> {
  const e = await prisma.entity.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!e) throw notFound('Entidade não encontrada');
}

// ---------------- fontes de dados ----------------
export async function addDataSource(ctx: Ctx, entityId: string, input: z.infer<typeof createDataSourceSchema>) {
  await ensureEntity(entityId);
  const ds = await prisma.dataSource.create({ data: { entityId, ...input, config: input.config as Prisma.InputJsonValue | undefined } });
  await audit(ctx, { action: 'CREATE', resource: 'dataSource', resourceId: ds.id, after: ds });
  return ds;
}

export async function updateDataSource(ctx: Ctx, entityId: string, id: string, input: z.infer<typeof updateDataSourceSchema>) {
  const before = await prisma.dataSource.findFirst({ where: { id, entityId, deletedAt: null } });
  if (!before) throw notFound('Fonte não encontrada');
  const after = await prisma.dataSource.update({ where: { id }, data: { ...input, config: input.config as Prisma.InputJsonValue | undefined, circuitOpenUntil: null, consecutiveFailures: 0 } });
  await audit(ctx, { action: 'UPDATE', resource: 'dataSource', resourceId: id, before, after });
  return after;
}

export async function removeDataSource(ctx: Ctx, entityId: string, id: string): Promise<void> {
  const before = await prisma.dataSource.findFirst({ where: { id, entityId, deletedAt: null } });
  if (!before) throw notFound('Fonte não encontrada');
  await prisma.dataSource.update({ where: { id }, data: { deletedAt: new Date(), isActive: false, syncEnabled: false } });
  await audit(ctx, { action: 'SOFT_DELETE', resource: 'dataSource', resourceId: id, before });
}

// ---------------- contatos ----------------
export async function listContacts(entityId: string) {
  return prisma.contact.findMany({ where: { entityId, deletedAt: null }, orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] });
}

export async function addContact(ctx: Ctx, entityId: string, input: z.infer<typeof createContactSchema>) {
  await ensureEntity(entityId);
  const c = await prisma.contact.create({ data: { entityId, ...input } });
  await audit(ctx, { action: 'CREATE', resource: 'contact', resourceId: c.id, after: { entityId, name: c.name, role: c.role } });
  return c;
}

export async function updateContact(ctx: Ctx, entityId: string, id: string, input: z.infer<typeof updateContactSchema>) {
  const before = await prisma.contact.findFirst({ where: { id, entityId, deletedAt: null } });
  if (!before) throw notFound('Contato não encontrado');
  const after = await prisma.contact.update({ where: { id }, data: input });
  await audit(ctx, { action: 'UPDATE', resource: 'contact', resourceId: id, before: { name: before.name, role: before.role }, after: { name: after.name, role: after.role } });
  return after;
}

export async function removeContact(ctx: Ctx, entityId: string, id: string): Promise<void> {
  const before = await prisma.contact.findFirst({ where: { id, entityId, deletedAt: null } });
  if (!before) throw notFound('Contato não encontrado');
  await prisma.contact.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  await audit(ctx, { action: 'SOFT_DELETE', resource: 'contact', resourceId: id, before: { name: before.name } });
}

// ---------------- importação em lote ----------------
export const IMPORT_MAX_SIZE = 5 * 1024 * 1024;

export interface ImportFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

/**
 * CSV/XLSX com colunas: tipo, entidade, municipio (opcional), uf, url, nome_completo (opcional).
 * Idempotente: entidade existente (tipo+município+UF) é reaproveitada; URL já cadastrada é ignorada.
 */
export async function importBatch(ctx: Ctx, file: ImportFile) {
  if (file.buffer.length === 0) throw badRequest('Arquivo vazio');
  if (file.buffer.length > IMPORT_MAX_SIZE) throw badRequest('Arquivo excede 5 MB');
  const rows = await parseRows(file);
  const result = { created: 0, reused: 0, sourcesCreated: 0, errors: [] as Array<{ line: number; error: string }> };
  for (let i = 0; i < rows.length; i += 1) {
    const parsed = importEntityRowSchema.safeParse(rows[i]);
    if (!parsed.success) {
      result.errors.push({ line: i + 2, error: parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') });
      continue;
    }
    const row: ImportEntityRow = parsed.data;
    const municipality = (row.municipio ?? row.entidade).trim();
    const shortName = `${row.tipo} ${row.entidade}`.toUpperCase();
    const name = row.nome_completo?.trim() || defaultFullName(row.tipo, row.entidade);
    const existing = await prisma.entity.findUnique({ where: { type_municipality_uf: { type: row.tipo, municipality, uf: row.uf } } });
    const entity = existing ?? (await prisma.entity.create({ data: { type: row.tipo, name, shortName, municipality, uf: row.uf } }));
    if (existing) result.reused += 1;
    else result.created += 1;
    const ds = await prisma.dataSource.findUnique({ where: { provider_url: { provider: 'ASSESI_PORTAL', url: row.url.trim() } } });
    if (!ds) {
      await prisma.dataSource.create({ data: { entityId: entity.id, provider: 'ASSESI_PORTAL', url: row.url.trim(), label: 'Portal do Cliente' } });
      result.sourcesCreated += 1;
    }
  }
  await audit(ctx, { action: 'IMPORT', resource: 'entity', after: { file: file.originalname, ...result, errors: result.errors.length } });
  return result;
}

function defaultFullName(type: string, entity: string): string {
  const prefix: Record<string, string> = { PM: 'PREFEITURA MUNICIPAL DE', CM: 'CÂMARA MUNICIPAL DE' };
  return `${prefix[type] ?? type} ${entity}`.toUpperCase();
}

async function parseRows(file: ImportFile): Promise<Array<Record<string, string>>> {
  const isXlsx = file.originalname.toLowerCase().endsWith('.xlsx') || file.mimetype.includes('spreadsheetml');
  if (isXlsx) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw badRequest('Planilha vazia');
    const headers: string[] = [];
    const rows: Array<Record<string, string>> = [];
    ws.eachRow((row, n) => {
      const values = (row.values as Array<unknown>).slice(1).map((v) => (v === null || v === undefined ? '' : String((v as { text?: string }).text ?? v).trim()));
      if (n === 1) {
        headers.push(...values.map((h) => h.toLowerCase().replace(/\s+/g, '_')));
        return;
      }
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => (obj[h] = values[i] ?? ''));
      if (Object.values(obj).some((v) => v)) rows.push(obj);
    });
    return rows;
  }
  const text = file.buffer.toString('utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw badRequest('CSV sem linhas de dados');
  const sep = (lines[0]!.match(/;/g) ?? []).length > (lines[0]!.match(/,/g) ?? []).length ? ';' : ',';
  const headers = lines[0]!.split(sep).map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return lines.slice(1).map((line) => {
    const cols = line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => (obj[h] = cols[i] ?? ''));
    return obj;
  });
}
