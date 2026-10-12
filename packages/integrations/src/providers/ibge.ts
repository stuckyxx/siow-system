/**
 * IBGE — Localidades (API pública, somente leitura): municípios por UF, com código IBGE de 7 dígitos.
 * https://servicodados.ibge.gov.br/api/v1/localidades/estados/{UF}/municipios
 */
import { httpRequest } from '../http/client.js';
import type { ProviderContext } from '../types.js';

export interface IbgeMunicipality { ibgeCode: string; name: string; uf: string; microregion: string | null; mesoregion: string | null }

export async function fetchIbgeMunicipalities(uf: string, ctx: Pick<ProviderContext, 'timeoutMs' | 'userAgent' | 'fetchImpl'>): Promise<IbgeMunicipality[]> {
  const res = await httpRequest(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${encodeURIComponent(uf.toUpperCase())}/municipios?orderBy=nome`, { timeoutMs: ctx.timeoutMs, userAgent: ctx.userAgent, fetchImpl: ctx.fetchImpl });
  const data = JSON.parse(res.text()) as Array<{ id: number; nome: string; microrregiao?: { nome?: string; mesorregiao?: { nome?: string } } | null; 'regiao-imediata'?: { nome?: string; 'regiao-intermediaria'?: { nome?: string } } | null }>;
  if (!Array.isArray(data)) throw new Error('IBGE: resposta inesperada');
  return data.map((m) => ({
    ibgeCode: String(m.id),
    name: m.nome,
    uf: uf.toUpperCase(),
    microregion: m.microrregiao?.nome ?? m['regiao-imediata']?.nome ?? null,
    mesoregion: m.microrregiao?.mesorregiao?.nome ?? m['regiao-imediata']?.['regiao-intermediaria']?.nome ?? null,
  }));
}
