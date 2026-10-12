/**
 * Compras.gov.br — API de dados abertos (módulo de contratações, Lei 14.133). Somente leitura, sem credenciais.
 * Devolve o mesmo formato bruto do PNCP (PncpRaw) para reaproveitar o importador de licitações.
 * https://dadosabertos.compras.gov.br/modulo-contratacoes/1_consultarContratacoes_PNCP_14133
 */
import { httpRequest } from '../http/client.js';
import type { ProviderContext } from '../types.js';
import type { PncpRaw, PncpSearch } from './pncp.js';

/** Código de modalidade do Compras.gov (legado) ↔ id de modalidade do PNCP (verificado na API em 10/2026). */
const COMPRAS_MODALITY: Record<number, number> = { 4: 3, 6: 5, 8: 6, 9: 7 };

export async function fetchComprasGov(s: PncpSearch, ctx: Pick<ProviderContext, 'timeoutMs' | 'userAgent' | 'fetchImpl'> & { apiUrl?: string }): Promise<{ items: PncpRaw[]; warnings: string[] }> {
  const base = (ctx.apiUrl || 'https://dadosabertos.compras.gov.br').replace(/\/+$/, '');
  const items: PncpRaw[] = []; const warnings: string[] = [];
  for (const pncpMod of s.modalities) {
    const mod = COMPRAS_MODALITY[pncpMod];
    if (!mod) { warnings.push(`Compras.gov: modalidade PNCP ${pncpMod} não disponível nesta fonte`); continue; }
    for (let page = 1; page <= (s.maxPages ?? 3); page++) {
      const url = `${base}/modulo-contratacoes/1_consultarContratacoes_PNCP_14133?dataPublicacaoPncpInicial=${s.from}&dataPublicacaoPncpFinal=${s.to}&codigoModalidade=${mod}&unidadeOrgaoUfSigla=${encodeURIComponent(s.uf.toUpperCase())}&pagina=${page}&tamanhoPagina=100`;
      let res;
      try { res = await httpRequest(url, { timeoutMs: ctx.timeoutMs, userAgent: ctx.userAgent, fetchImpl: ctx.fetchImpl, headers: { Accept: 'application/json' } }); }
      catch (e) { warnings.push(`Compras.gov modalidade ${mod} página ${page}: ${e instanceof Error ? e.message : String(e)}`); break; }
      if (res.status === 204 || !res.buffer.length) break;
      if (res.status >= 400) { warnings.push(`Compras.gov modalidade ${mod}: HTTP ${res.status}`); break; }
      let j: { resultado?: Array<Record<string, unknown>>; totalPaginas?: number; paginasRestantes?: number };
      try { j = JSON.parse(res.text()) as typeof j; } catch { warnings.push(`Compras.gov modalidade ${mod}: resposta inválida`); break; }
      for (const r of j.resultado ?? []) {
        const g = (k: string) => r[k];
        items.push({
          numeroControlePNCP: String(g('numeroControlePNCP') ?? ''), numeroCompra: g('numeroCompra') as string | undefined, anoCompra: (g('anoCompraPncp') ?? g('anoCompra')) as number | undefined, objetoCompra: g('objetoCompra') as string | undefined,
          modalidadeId: (g('modalidadeIdPncp') ?? g('modalidadeId')) as number | undefined, modalidadeNome: g('modalidadeNome') as string | undefined, valorTotalEstimado: (g('valorTotalEstimado') as number | null | undefined) ?? null,
          dataPublicacaoPncp: (g('dataPublicacaoPncp') as string | null | undefined) ?? null, dataAberturaProposta: (g('dataAberturaPropostaPncp') ?? g('dataAberturaProposta')) as string | null | undefined ?? null, dataEncerramentoProposta: (g('dataEncerramentoPropostaPncp') ?? g('dataEncerramentoProposta')) as string | null | undefined ?? null,
          orgaoEntidade: { cnpj: g('orgaoEntidadeCnpj') as string | undefined, razaoSocial: g('orgaoEntidadeRazaoSocial') as string | undefined }, unidadeOrgao: { ufSigla: g('unidadeOrgaoUfSigla') as string | undefined, municipioNome: g('unidadeOrgaoMunicipioNome') as string | undefined, nomeUnidade: g('unidadeOrgaoNomeUnidade') as string | undefined, codigoIbge: g('unidadeOrgaoCodigoIbge') != null ? String(g('unidadeOrgaoCodigoIbge')) : undefined },
          linkSistemaOrigem: (g('linkSistemaOrigem') as string | null | undefined) ?? (g('numeroControlePNCP') ? `https://pncp.gov.br/app/editais/${String(g('orgaoEntidadeCnpj') ?? '')}/${String(g('anoCompraPncp') ?? '')}/${String(g('sequencialCompraPncp') ?? '')}` : null), situacaoCompraNome: (g('situacaoCompraNomePncp') ?? g('situacaoCompraNome')) as string | null | undefined ?? null,
        });
      }
      if (!(j.paginasRestantes && j.paginasRestantes > 0) && !(j.totalPaginas && page < j.totalPaginas)) break;
    }
  }
  return { items: items.filter((i) => i.numeroControlePNCP), warnings };
}
