/**
 * Entidades (prefeituras/câmaras), fontes de dados, contatos e importação em lote.
 */
import ExcelJS from 'exceljs';
import { Prisma } from '@siow/db';
import { dateToIso, importEntityRowSchema, isAdoisPartnerUrl, parseBRL, parseBrDate, parseCompetence, providerForUrl, toDecimalString, type EntitySummary, type ImportEntityRow, type Paginated } from '@siow/shared';
import { getProvider, normalizeKey, type AdoisPortalProvider } from '@siow/integrations';
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
  paidInvoices: 'paid_count',
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
      (SELECT COUNT(*) FROM invoices i WHERE i."entityId" = e.id AND i.status = 'PAID' AND i."deletedAt" IS NULL)::int AS paid_count,
      COALESCE((SELECT SUM(COALESCE(i."paidAmount", i.amount)) FROM invoices i WHERE i."entityId" = e.id AND i.status = 'PAID' AND i."deletedAt" IS NULL), 0) AS paid_total,
      (SELECT COUNT(*) FROM invoices i WHERE i."entityId" = e.id AND i."needsReconciliation" AND i."deletedAt" IS NULL)::int AS reconciliation_count,
      (SELECT i."paidAt" FROM invoices i WHERE i."entityId" = e.id AND i.status = 'PAID' AND i."deletedAt" IS NULL ORDER BY i."paidAt" DESC NULLS LAST LIMIT 1) AS last_payment_at,
      (SELECT COALESCE(i."paidAmount", i.amount) FROM invoices i WHERE i."entityId" = e.id AND i.status = 'PAID' AND i."deletedAt" IS NULL ORDER BY i."paidAt" DESC NULLS LAST LIMIT 1) AS last_payment_amount,
      (SELECT MAX(a."performedAt") FROM collection_attempts a JOIN collection_cases cc ON cc.id = a."caseId" WHERE cc."entityId" = e.id) AS last_collection_at,
      (SELECT cc.status FROM collection_cases cc WHERE cc."entityId" = e.id ORDER BY cc."updatedAt" DESC LIMIT 1) AS collection_status,
      (SELECT COUNT(*) FROM service_orders so WHERE so."entityId" = e.id AND so."deletedAt" IS NULL AND so.status NOT IN ('SIGNED','CANCELLED'))::int AS pending_service_orders,
      (SELECT MAX(ds."lastSyncAt") FROM data_sources ds WHERE ds."entityId" = e.id AND ds."deletedAt" IS NULL) AS last_sync_at,
      (SELECT ds."lastSyncStatus" FROM data_sources ds WHERE ds."entityId" = e.id AND ds."deletedAt" IS NULL ORDER BY ds."lastSyncAt" DESC NULLS LAST LIMIT 1) AS last_sync_status,
      (SELECT COUNT(*) FROM contracts c WHERE c."entityId" = e.id AND c."deletedAt" IS NULL)::int AS contract_count,
      (SELECT COUNT(*) FROM invoices i WHERE i."entityId" = e.id AND i."deletedAt" IS NULL)::int AS invoice_count,
      (SELECT COUNT(*) FROM data_sources ds WHERE ds."entityId" = e.id AND ds."deletedAt" IS NULL)::int AS source_count
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
    paidInvoices: Number(r['paid_count'] ?? 0),
    paidTotal: String(r['paid_total'] ?? '0'),
    lastPaymentAt: dateToIso(r['last_payment_at'] as Date | null),
    lastPaymentAmount: r['last_payment_amount'] === null || r['last_payment_amount'] === undefined ? null : String(r['last_payment_amount']),
    lastCollectionAt: r['last_collection_at'] ? (r['last_collection_at'] as Date).toISOString() : null,
    collectionStatus: (r['collection_status'] as EntitySummary['collectionStatus']) ?? null,
    pendingServiceOrders: Number(r['pending_service_orders'] ?? 0),
    lastSyncAt: r['last_sync_at'] ? (r['last_sync_at'] as Date).toISOString() : null,
    lastSyncStatus: (r['last_sync_status'] as EntitySummary['lastSyncStatus']) ?? null,
    needsReconciliation: Number(r['reconciliation_count'] ?? 0),
    contractCount: Number(r['contract_count'] ?? 0),
    invoiceCount: Number(r['invoice_count'] ?? 0),
    sourceCount: Number(r['source_count'] ?? 0),
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

/**
 * Exclusão lógica. Só é permitida sem notas vinculadas (a nota é o registro financeiro; uma entidade com
 * histórico deve ser encerrada, não excluída). As fontes de dados ficam desativadas para o cron não sincronizá-las.
 */
export async function softDelete(ctx: Ctx, id: string): Promise<void> {
  const before = await prisma.entity.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw notFound('Entidade não encontrada');
  const invoices = await prisma.invoice.count({ where: { entityId: id, deletedAt: null } });
  if (invoices > 0) throw badRequest(`A entidade possui ${invoices} nota(s) vinculada(s) e não pode ser excluída. Se o contrato terminou, desmarque "ativa" na edição.`);
  await prisma.dataSource.updateMany({ where: { entityId: id }, data: { syncEnabled: false } });
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
  const provider = input.provider ?? providerForUrl(input.url);
  if (!provider) throw badRequest('Não foi possível identificar o portal pela URL');
  if (isAdoisPartnerUrl(input.url) && !(input.config as { entityKey?: string } | null | undefined)?.entityKey) {
    throw badRequest('Este é um link de parceiro da Adois (várias entidades). Use "Importar link de parceiro" em Entidades.');
  }
  const ds = await prisma.dataSource.create({ data: { entityId, ...input, provider, label: input.label ?? providerLabel(provider), config: input.config as Prisma.InputJsonValue | undefined } });
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
  const sheets = await parseSheets(file);
  const rows = sheets.entities;
  const result = { created: 0, reused: 0, sourcesCreated: 0, invoicesCreated: 0, invoicesSkipped: 0, errors: [] as Array<{ line: number; error: string }> };
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
    const url = row.url.trim();
    const provider = providerForUrl(url);
    if (!provider) {
      result.errors.push({ line: i + 2, error: 'url: portal não reconhecido (use https de assesi.com.br ou adoissolucoes.com)' });
      continue;
    }
    if (isAdoisPartnerUrl(url)) {
      result.errors.push({ line: i + 2, error: 'url: link de parceiro da Adois (t=2) — use "Importar link de parceiro"' });
      continue;
    }
    const ds = await prisma.dataSource.findFirst({ where: { provider, url, entityId: entity.id, deletedAt: null } });
    if (!ds) {
      await prisma.dataSource.create({ data: { entityId: entity.id, provider, url, label: providerLabel(provider) } });
      result.sourcesCreated += 1;
    }
  }
  if (sheets.invoices.length) {
    const r = await importInvoiceRows(sheets.invoices);
    result.invoicesCreated = r.created;
    result.invoicesSkipped = r.skipped;
    result.errors.push(...r.errors);
  }
  await audit(ctx, { action: 'IMPORT', resource: 'entity', after: { file: file.originalname, ...result, errors: result.errors.length } });
  return result;
}

/**
 * Aba "Notas": cria notas (origem IMPORT) para entidades já cadastradas, pulando números existentes.
 * Nunca altera nota existente — a sincronização com o portal continua sendo a fonte da verdade.
 */
async function importInvoiceRows(rows: Array<Record<string, string>>): Promise<{ created: number; skipped: number; errors: Array<{ line: number; error: string }> }> {
  const out = { created: 0, skipped: 0, errors: [] as Array<{ line: number; error: string }> };
  const entities = await prisma.entity.findMany({ where: { deletedAt: null }, select: { id: true, name: true, shortName: true } });
  const byKey = new Map<string, string>();
  for (const e of entities) { byKey.set(normalizeKey(e.name), e.id); if (e.shortName) byKey.set(normalizeKey(e.shortName), e.id); }
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]!;
    const line = i + 2;
    const entityId = byKey.get(normalizeKey(r['entidade'] ?? ''));
    if (!entityId) { out.errors.push({ line, error: `notas: entidade "${r['entidade'] ?? ''}" não cadastrada` }); continue; }
    const number = (r['numero'] ?? '').trim();
    const competence = parseCompetence(r['competencia'] ?? '') ?? (r['exercicio'] && /^\d{1,2}$/.test(r['competencia'] ?? '') ? { month: Number(r['competencia']), year: Number(r['exercicio']) } : null);
    const amount = parseBRL(r['valor'] ?? '');
    if (!number || !competence || amount === null) { out.errors.push({ line, error: 'notas: informe numero, competencia (MM/AAAA) e valor' }); continue; }
    const paidAt = parseBrDate(r['pagamento'] ?? '');
    const situ = normalizeKey(r['situacao'] ?? '');
    const status = situ.startsWith('PAG') || situ.startsWith('QUIT') ? 'PAID' : situ.startsWith('CANCEL') ? 'CANCELLED' : situ.startsWith('PEND') ? 'PENDING' : paidAt ? 'PAID' : 'PENDING';
    const exists = await prisma.invoice.findUnique({ where: { entityId_number: { entityId, number } }, select: { id: true } });
    if (exists) { out.skipped += 1; continue; }
    const contractNumber = (r['contrato'] ?? '').trim();
    const contract = contractNumber ? await prisma.contract.findFirst({ where: { entityId, deletedAt: null, OR: [{ number: contractNumber }, { externalCode: contractNumber }] }, select: { id: true } }) : null;
    const now = new Date();
    const issueDate = parseBrDate(r['emissao'] ?? '');
    const inv = await prisma.invoice.create({
      data: {
        entityId, number, contractId: contract?.id ?? null, competenceMonth: competence.month, competenceYear: competence.year,
        amount: new Prisma.Decimal(toDecimalString(amount)), issueDate: issueDate ? new Date(`${issueDate}T00:00:00Z`) : null,
        status, paidAt: paidAt ? new Date(`${paidAt}T00:00:00Z`) : null, paidAmount: status === 'PAID' ? new Prisma.Decimal(toDecimalString(amount)) : null,
        description: (r['descricao'] ?? '').trim() || null, origin: 'IMPORT', firstSeenAt: now, lastSeenAt: now,
      },
    });
    await prisma.invoiceEvent.create({ data: { invoiceId: inv.id, type: 'CREATED', origin: 'IMPORT', newValue: status, note: 'Nota importada por planilha' } });
    out.created += 1;
  }
  return out;
}

const providerLabel = (p: string): string => (p === 'ADOIS_PORTAL' ? 'Portal do Cliente (Adois)' : 'Portal do Cliente');

export interface ImportPartnerResult {
  company: string | null;
  entities: Array<{ id: string; shortName: string; name: string; created: boolean; sourceCreated: boolean; contractCodes: string[]; invoices: number; pending: number; pendingAmount: number }>;
  unassigned: number;
  warnings: string[];
}

/**
 * Link de parceiro da Adois (t=2): a página lista notas da empresa parceira para vários municípios.
 * Lê o link, identifica cada entidade (prefeitura/câmara) pelas descrições das notas e cadastra
 * uma entidade + uma fonte por município (mesma URL, `config.entityKey` distinto). Idempotente:
 * entidade já existente (tipo + município sem acento + UF) e fonte já cadastrada são reaproveitadas.
 * Não sincroniza: as fontes novas entram na frente da fila de "Sincronizar todas".
 */
export async function importPartner(ctx: Ctx, url: string): Promise<ImportPartnerResult> {
  const provider = getProvider('ADOIS_PORTAL') as AdoisPortalProvider;
  const discovered = await provider.discoverPartnerEntities(url, {
    timeoutMs: Number(process.env['SYNC_HTTP_TIMEOUT_MS'] ?? 20_000),
    userAgent: process.env['SYNC_USER_AGENT'] ?? 'SiowSystem/1.0',
  });
  const result: ImportPartnerResult = { company: discovered.company, entities: [], unassigned: discovered.unassigned, warnings: discovered.warnings };
  for (const g of discovered.groups) {
    const candidates = await prisma.entity.findMany({ where: { type: g.type, uf: g.uf, deletedAt: null } });
    let entity = candidates.find((e) => normalizeKey(e.municipality) === normalizeKey(g.municipality)) ?? null;
    const created = !entity;
    if (!entity) {
      entity = await prisma.entity.create({ data: { type: g.type, name: g.name, shortName: g.shortName, municipality: g.municipality, uf: g.uf, notes: `Cadastrada pelo link de parceiro ${discovered.company ?? 'Adois'}` } });
      await audit(ctx, { action: 'CREATE', resource: 'entity', resourceId: entity.id, after: { ...entity, via: 'importPartner' } });
    }
    let ds = await prisma.dataSource.findFirst({ where: { provider: 'ADOIS_PORTAL', url, entityId: entity.id, deletedAt: null } });
    const sourceCreated = !ds;
    if (!ds) {
      ds = await prisma.dataSource.create({
        data: { entityId: entity.id, provider: 'ADOIS_PORTAL', url, label: `Portal Adois — parceiro ${discovered.company ?? ''}`.trim(), externalEntityType: '2', config: { partner: true, entityKey: g.key } },
      });
      await audit(ctx, { action: 'CREATE', resource: 'dataSource', resourceId: ds.id, after: ds });
    }
    result.entities.push({ id: entity.id, shortName: entity.shortName ?? g.shortName, name: entity.name, created, sourceCreated, contractCodes: g.contractCodes, invoices: g.invoices.length, pending: g.pendingCount, pendingAmount: g.pendingAmount });
  }
  await audit(ctx, { action: 'IMPORT', resource: 'entity', after: { partnerUrl: url, company: discovered.company, entities: result.entities.length, created: result.entities.filter((e) => e.created).length } });
  return result;
}

export interface ImportLinkResult extends ImportPartnerResult {
  kind: 'partner' | 'entity';
}

/** "CÂMARA MUNICIPAL DE BOM LUGAR" / "PM TUNTUM" → tipo, município e nomes. */
export function entityFromPortalNames(fullName: string | null, shortName: string | null): { type: 'PM' | 'CM' | 'INSTITUTO' | 'AUTARQUIA' | 'FUNDO' | 'CONSORCIO' | 'OUTRO'; municipality: string; name: string; shortName: string } | null {
  const full = (fullName ?? '').trim();
  const short = (shortName ?? '').trim();
  const typeFrom = (t: string): 'PM' | 'CM' | 'INSTITUTO' | 'AUTARQUIA' | 'FUNDO' | 'CONSORCIO' | 'OUTRO' | null => {
    const n = normalizeKey(t);
    if (/^PREFEITURA|^PM\b/.test(n)) return 'PM';
    if (/^CAMARA|^CM\b/.test(n)) return 'CM';
    if (/^INSTITUTO/.test(n)) return 'INSTITUTO';
    if (/^AUTARQUIA/.test(n)) return 'AUTARQUIA';
    if (/^FUNDO/.test(n)) return 'FUNDO';
    if (/^CONSORCIO/.test(n)) return 'CONSORCIO';
    return null;
  };
  const titleCase = (m: string): string => m.toLowerCase().replace(/(^|\s)(\S)/g, (_x, sp: string, c: string) => sp + c.toUpperCase()).replace(/\b(De|Do|Da|Dos|Das)\b/g, (w) => w.toLowerCase());
  if (full) {
    const type = typeFrom(full) ?? 'OUTRO';
    const municipality = titleCase(full.replace(/^.*?\b(?:DE|DO|DA)\s+/i, '').replace(/\s*[-–]\s*[A-Z]{2}$/i, '').trim() || full);
    const prefix = type === 'PM' ? 'PM' : type === 'CM' ? 'CM' : type;
    return { type, municipality, name: full.toUpperCase(), shortName: short || `${prefix} ${municipality.toUpperCase()}` };
  }
  if (short) {
    const type = typeFrom(short) ?? 'OUTRO';
    const municipality = titleCase(short.replace(/^(PM|CM|PREFEITURA(?:\s+MUNICIPAL)?|C[ÂA]MARA(?:\s+MUNICIPAL)?)\s+(?:DE\s+)?/i, '').trim() || short);
    const name = type === 'PM' ? `PREFEITURA MUNICIPAL DE ${municipality.toUpperCase()}` : type === 'CM' ? `CÂMARA MUNICIPAL DE ${municipality.toUpperCase()}` : short.toUpperCase();
    return { type, municipality, name, shortName: short.toUpperCase() };
  }
  return null;
}

/**
 * Importa pelo link web: link de parceiro da Adois → importPartner; link de entidade (Assesi ou Adois)
 * → lê a página do portal, identifica a entidade (nome, tipo, município, UF) e cadastra entidade + fonte.
 * Não sincroniza (a tela dispara a sincronização de cada entidade em seguida, dentro do limite por requisição).
 */
export async function importLink(ctx: Ctx, url: string): Promise<ImportLinkResult> {
  if (isAdoisPartnerUrl(url)) return { kind: 'partner', ...(await importPartner(ctx, url)) };
  const providerKey = providerForUrl(url);
  if (!providerKey) throw badRequest('Portal não reconhecido na URL');
  const existingSource = await prisma.dataSource.findFirst({ where: { provider: providerKey, url, deletedAt: null }, include: { entity: true } });
  const snapshot = await getProvider(providerKey).fetchSnapshot({ url, config: null }, { timeoutMs: Number(process.env['SYNC_HTTP_TIMEOUT_MS'] ?? 20_000), userAgent: process.env['SYNC_USER_AGENT'] ?? 'SiowSystem/1.0' });
  const pending = snapshot.invoices.filter((i) => i.status === 'PENDING');
  const pendingAmount = Math.round(pending.reduce((s, i) => s + i.amount, 0) * 100) / 100;
  const contractCodes = [...new Set(snapshot.contracts.map((c) => c.number ?? c.externalCode).filter((x): x is string => Boolean(x)))];
  const warnings = [...snapshot.warnings];

  if (existingSource && !existingSource.entity.deletedAt) {
    const e = existingSource.entity;
    return { kind: 'entity', company: null, unassigned: 0, warnings, entities: [{ id: e.id, shortName: e.shortName ?? e.name, name: e.name, created: false, sourceCreated: false, contractCodes, invoices: snapshot.invoices.length, pending: pending.length, pendingAmount }] };
  }
  const info = entityFromPortalNames(snapshot.entity.name, snapshot.entity.shortName);
  if (!info) throw badRequest('Não foi possível identificar o nome da entidade na página do portal');
  const uf = (snapshot.entity.uf ?? '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(uf)) throw badRequest('Não foi possível identificar a UF da entidade na página do portal');
  const candidates = await prisma.entity.findMany({ where: { type: info.type, uf, deletedAt: null } });
  let entity = candidates.find((e) => normalizeKey(e.municipality) === normalizeKey(info.municipality)) ?? null;
  const created = !entity;
  if (!entity) {
    entity = await prisma.entity.create({ data: { type: info.type, name: info.name, shortName: info.shortName, municipality: info.municipality, uf, logoUrl: snapshot.entity.logoUrl } });
    await audit(ctx, { action: 'CREATE', resource: 'entity', resourceId: entity.id, after: { ...entity, via: 'importLink' } });
  }
  const ds = await prisma.dataSource.create({ data: { entityId: entity.id, provider: providerKey, url, label: providerLabel(providerKey), externalEntityCode: snapshot.entity.externalCode, externalEntityType: snapshot.entity.externalType } });
  await audit(ctx, { action: 'CREATE', resource: 'dataSource', resourceId: ds.id, after: ds });
  return { kind: 'entity', company: null, unassigned: 0, warnings, entities: [{ id: entity.id, shortName: entity.shortName ?? entity.name, name: entity.name, created, sourceCreated: true, contractCodes, invoices: snapshot.invoices.length, pending: pending.length, pendingAmount }] };
}

function defaultFullName(type: string, entity: string): string {
  const prefix: Record<string, string> = { PM: 'PREFEITURA MUNICIPAL DE', CM: 'CÂMARA MUNICIPAL DE' };
  return `${prefix[type] ?? type} ${entity}`.toUpperCase();
}

/** Lê a planilha: aba de entidades (cabeçalho com "tipo") e aba de notas (cabeçalho com "numero"); CSV = uma aba só. */
async function parseSheets(file: ImportFile): Promise<{ entities: Array<Record<string, string>>; invoices: Array<Record<string, string>> }> {
  const classify = (sheets: Array<{ name: string; rows: Array<Record<string, string>>; headers: string[] }>) => {
    const out = { entities: [] as Array<Record<string, string>>, invoices: [] as Array<Record<string, string>> };
    for (const sh of sheets) {
      if (sh.headers.includes('numero')) out.invoices.push(...sh.rows);
      else if (sh.headers.includes('tipo') || sh.headers.includes('url')) out.entities.push(...sh.rows);
    }
    return out;
  };
  const isXlsx = file.originalname.toLowerCase().endsWith('.xlsx') || file.mimetype.includes('spreadsheetml');
  if (isXlsx) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    if (!wb.worksheets.length) throw badRequest('Planilha vazia');
    const sheets = wb.worksheets.map((ws) => {
      const headers: string[] = [];
      const rows: Array<Record<string, string>> = [];
      ws.eachRow((row, n) => {
        const values = (row.values as Array<unknown>).slice(1).map((v) => {
          if (v === null || v === undefined) return '';
          if (v instanceof Date) return `${String(v.getUTCDate()).padStart(2, '0')}/${String(v.getUTCMonth() + 1).padStart(2, '0')}/${v.getUTCFullYear()}`;
          if (typeof v === 'object') return String((v as { text?: string; result?: unknown }).text ?? (v as { result?: unknown }).result ?? '').trim();
          return String(v).trim();
        });
        if (n === 1) { headers.push(...values.map((h) => h.toLowerCase().replace(/\s+/g, '_'))); return; }
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => (obj[h] = values[i] ?? ''));
        if (Object.values(obj).some((v) => v)) rows.push(obj);
      });
      return { name: ws.name, headers, rows };
    });
    return classify(sheets);
  }
  const text = file.buffer.toString('utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw badRequest('CSV sem linhas de dados');
  const sep = (lines[0]!.match(/;/g) ?? []).length > (lines[0]!.match(/,/g) ?? []).length ? ';' : ',';
  const headers = lines[0]!.split(sep).map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const rows = lines.slice(1).map((line) => {
    const cols = line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => (obj[h] = cols[i] ?? ''));
    return obj;
  });
  return classify([{ name: 'csv', headers, rows }]);
}
