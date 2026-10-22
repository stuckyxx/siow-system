/**
 * Mapa de cobertura comercial (Fase 15). Ligação município ↔ cliente pelo CÓDIGO IBGE (7 dígitos).
 *
 * Situação efetiva de cada município (ordem de prioridade):
 *   1. "Em implantação" marcada manualmente — implantação é a fase de um cliente recém-contratado;
 *   2. "Cliente ativo" — calculado: há contrato ATIVO em alguma entidade com o código IBGE do município;
 *   3. "Em negociação" marcada manualmente;
 *   4. "Sem atuação".
 */
import { z } from 'zod';
import { prisma } from '../db.js';
import { currentOrgId } from '../tenant.js';
import { audit } from '../audit.js';
import { badRequest, type Ctx } from '../http.js';
import { CAPITALS, COVERAGE_UFS, MUNICIPALITIES } from '../geo/municipios-ma-pi-to.js';

export const COVERAGE_STATUSES = ['ATIVO', 'IMPLANTACAO', 'NEGOCIACAO', 'NENHUMA'] as const;
export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];
export const MANUAL_STATUSES = ['IMPLANTACAO', 'NEGOCIACAO', 'NENHUMA'] as const;
export type ManualStatus = (typeof MANUAL_STATUSES)[number];
export const setCoverageStatusSchema = z.object({ status: z.enum(MANUAL_STATUSES), notes: z.string().max(1000).optional().nullable() });

const BY_CODE = new Map(MUNICIPALITIES.map(([id, uf, name]) => [id, { id, uf, name }]));

/** Normaliza nome de município para comparação: sem acento, minúsculo, sem pontuação e espaços extras. */
export function normalizeName(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
/** Grafias usadas no cadastro que diferem do nome oficial (aprovadas na Fase 15). */
const ALIASES: Record<string, string> = {
  'MA|campestre': '2102556', // Campestre do Maranhão
  'MA|edson lobao': '2104552', // Governador Edison Lobão
  'MA|edison lobao': '2104552',
  'MA|santa filomena': '2109759', // Santa Filomena do Maranhão (no PI existe outra Santa Filomena)
  'MA|santa quiteria': '2110104', // Santa Quitéria do Maranhão
  'MA|sao mateus': '2111508', // São Mateus do Maranhão
  'PI|cocal do alves': '2202729', // Cocal dos Alves
};
const BY_NAME = new Map(MUNICIPALITIES.map(([id, uf, name]) => [`${uf}|${normalizeName(name)}`, id]));

/** Código IBGE de um município de MA/PI/TO pelo nome e UF (null se não encontrado ou fora da cobertura). */
export function findIbgeCode(uf: string, municipality: string): string | null {
  const key = `${uf.toUpperCase()}|${normalizeName(municipality)}`;
  return ALIASES[key] ?? BY_NAME.get(key) ?? null;
}
export function isCoverageCode(code: string): boolean { return BY_CODE.has(code); }

export function effectiveStatus(hasActiveContract: boolean, manual: string | null | undefined): CoverageStatus {
  if (manual === 'IMPLANTACAO') return 'IMPLANTACAO';
  if (hasActiveContract) return 'ATIVO';
  if (manual === 'NEGOCIACAO') return 'NEGOCIACAO';
  return 'NENHUMA';
}

export interface CoverageEntity { id: string; name: string; shortName: string | null; type: string; activeContracts: number }
export interface CoverageMunicipality {
  ibge: string; uf: string; name: string; capital: boolean;
  status: CoverageStatus; manualStatus: ManualStatus | null; hasActiveContract: boolean;
  notes: string | null; updatedAt: string | null;
  entities: CoverageEntity[]; modules: string[];
}
export interface CoverageSummary { uf: string; total: number; ativo: number; implantacao: number; negociacao: number; livres: number; atendidosPct: number }
export interface IbgeMismatch { id: string; name: string; municipality: string; uf: string; ibgeCode: string; ibgeName: string | null }
export interface CoverageMap { municipalities: CoverageMunicipality[]; summary: CoverageSummary[]; entitiesWithoutIbge: number; ibgeMismatches: IbgeMismatch[] }

/** Municípios com alguma atuação (entidade cadastrada ou situação manual) e totais por estado. */
export async function getMap(): Promise<CoverageMap> {
  const [entities, statuses, withoutIbge] = await Promise.all([
    prisma.entity.findMany({
      where: { deletedAt: null, uf: { in: [...COVERAGE_UFS] }, ibgeCode: { not: null } },
      select: {
        id: true, name: true, shortName: true, type: true, ibgeCode: true, municipality: true, uf: true,
        contracts: { where: { deletedAt: null, status: 'ACTIVE' }, select: { object: true, opportunityId: true } },
      },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    }),
    prisma.municipalityStatus.findMany({ where: { uf: { in: [...COVERAGE_UFS] } } }),
    prisma.entity.count({ where: { deletedAt: null, uf: { in: [...COVERAGE_UFS] }, ibgeCode: null } }),
  ]);
  // módulos contratados: itens das oportunidades ganhas que originaram os contratos ativos (ou o objeto do contrato)
  const oppIds = [...new Set(entities.flatMap((e) => e.contracts.map((c) => c.opportunityId).filter((x): x is string => Boolean(x))))];
  const items = oppIds.length ? await prisma.opportunityItem.findMany({ where: { opportunityId: { in: oppIds } }, select: { opportunityId: true, description: true, catalogItem: { select: { name: true } } } }) : [];
  const itemsByOpp = new Map<string, string[]>();
  for (const it of items) { const l = itemsByOpp.get(it.opportunityId) ?? []; l.push(it.catalogItem?.name ?? it.description); itemsByOpp.set(it.opportunityId, l); }

  const byCode = new Map<string, { entities: CoverageEntity[]; modules: Set<string>; active: boolean }>();
  for (const e of entities) {
    const code = e.ibgeCode!; if (!BY_CODE.has(code)) continue;
    const g = byCode.get(code) ?? { entities: [], modules: new Set<string>(), active: false };
    g.entities.push({ id: e.id, name: e.name, shortName: e.shortName, type: e.type, activeContracts: e.contracts.length });
    for (const c of e.contracts) {
      g.active = true;
      const mods = c.opportunityId ? itemsByOpp.get(c.opportunityId) : undefined;
      if (mods?.length) mods.forEach((m) => g.modules.add(m)); else if (c.object) g.modules.add(c.object.length > 120 ? c.object.slice(0, 117) + '…' : c.object);
    }
    byCode.set(code, g);
  }
  const manual = new Map(statuses.map((s) => [s.ibgeCode, s]));
  const codes = new Set([...byCode.keys(), ...statuses.filter((s) => s.status !== 'NENHUMA' || s.notes).map((s) => s.ibgeCode)]);
  const municipalities: CoverageMunicipality[] = [...codes].filter((c) => BY_CODE.has(c)).map((code) => {
    const m = BY_CODE.get(code)!; const g = byCode.get(code); const st = manual.get(code);
    const manualStatus = (st?.status as ManualStatus | undefined) ?? null;
    return {
      ibge: code, uf: m.uf, name: m.name, capital: Boolean(CAPITALS[code]),
      status: effectiveStatus(Boolean(g?.active), manualStatus), manualStatus, hasActiveContract: Boolean(g?.active),
      notes: st?.notes ?? null, updatedAt: st?.updatedAt.toISOString() ?? null,
      entities: g?.entities ?? [], modules: [...(g?.modules ?? [])].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    };
  });
  const summary: CoverageSummary[] = COVERAGE_UFS.map((uf) => {
    const total = MUNICIPALITIES.filter((m) => m[1] === uf).length;
    const inUf = municipalities.filter((m) => m.uf === uf);
    const count = (s: CoverageStatus): number => inUf.filter((m) => m.status === s).length;
    const ativo = count('ATIVO'), implantacao = count('IMPLANTACAO'), negociacao = count('NEGOCIACAO');
    return { uf, total, ativo, implantacao, negociacao, livres: total - ativo - implantacao - negociacao, atendidosPct: total ? Math.round(((ativo + implantacao) / total) * 1000) / 10 : 0 };
  });
  // código IBGE que não corresponde ao município/UF cadastrado (provável erro de cadastro)
  const ibgeMismatches: IbgeMismatch[] = entities.filter((e) => { const exp = findIbgeCode(e.uf, e.municipality); return (exp && exp !== e.ibgeCode) || !BY_CODE.has(e.ibgeCode!); })
    .map((e) => ({ id: e.id, name: e.shortName ?? e.name, municipality: e.municipality, uf: e.uf, ibgeCode: e.ibgeCode!, ibgeName: BY_CODE.get(e.ibgeCode!)?.name ?? null }));
  return { municipalities, summary, entitiesWithoutIbge: withoutIbge, ibgeMismatches };
}

/** Altera a situação manual de um município (implantação / negociação / sem atuação). */
export async function setStatus(ctx: Ctx, ibge: string, input: z.infer<typeof setCoverageStatusSchema>): Promise<CoverageMunicipality> {
  const m = BY_CODE.get(ibge);
  if (!m) throw badRequest('Código IBGE fora da cobertura do mapa (MA, PI e TO)');
  const before = await prisma.municipalityStatus.findFirst({ where: { ibgeCode: ibge } });
  const data = { status: input.status, notes: input.notes ?? null, updatedByUserId: ctx.user.id.startsWith('apikey:') ? null : ctx.user.id };
  const after = before
    ? await prisma.municipalityStatus.update({ where: { id: before.id }, data })
    : await prisma.municipalityStatus.create({ data: { ...data, organizationId: currentOrgId(), ibgeCode: ibge, uf: m.uf } });
  await audit(ctx, { action: before ? 'UPDATE' : 'CREATE', resource: 'municipalityStatus', resourceId: ibge, before: before ? { status: before.status, notes: before.notes } : null, after: { municipio: `${m.name}/${m.uf}`, status: after.status, notes: after.notes } });
  const map = await getMap();
  return map.municipalities.find((x) => x.ibge === ibge) ?? { ibge, uf: m.uf, name: m.name, capital: Boolean(CAPITALS[ibge]), status: 'NENHUMA', manualStatus: input.status, hasActiveContract: false, notes: after.notes, updatedAt: after.updatedAt.toISOString(), entities: [], modules: [] };
}
