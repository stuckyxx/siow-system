/**
 * PNCP — Portal Nacional de Contratações Públicas (API pública de consulta, sem chave).
 * GET https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao?dataInicial=AAAAMMDD&dataFinal=AAAAMMDD&codigoModalidadeContratacao=N&uf=UF&pagina=P&tamanhoPagina=50
 * Somente leitura; o identificador oficial é `numeroControlePNCP` (chave contra duplicidade).
 */
import { httpRequest } from '../http/client.js';
import type { ProviderContext } from '../types.js';

export interface PncpRaw {
  numeroControlePNCP: string; numeroCompra?: string; anoCompra?: number; objetoCompra?: string; modalidadeId?: number; modalidadeNome?: string;
  valorTotalEstimado?: number | null; dataPublicacaoPncp?: string | null; dataAberturaProposta?: string | null; dataEncerramentoProposta?: string | null;
  orgaoEntidade?: { cnpj?: string; razaoSocial?: string } | null; unidadeOrgao?: { ufSigla?: string; municipioNome?: string; nomeUnidade?: string; codigoIbge?: string } | null;
  linkSistemaOrigem?: string | null; situacaoCompraNome?: string | null;
}

export interface PncpSearch { uf: string; from: string; to: string; modalities: number[]; maxPages?: number }

export async function fetchPncpPublications(s: PncpSearch, ctx: Pick<ProviderContext, 'timeoutMs' | 'userAgent' | 'fetchImpl'> & { apiUrl?: string }): Promise<{ items: PncpRaw[]; warnings: string[] }> {
  const items: PncpRaw[] = []; const warnings: string[] = [];
  const base = (ctx.apiUrl || 'https://pncp.gov.br/api/consulta/v1').replace(/\/+$/, '');
  const d = (iso: string) => iso.replace(/-/g, '');
  for (const mod of s.modalities) {
    for (let page = 1; page <= (s.maxPages ?? 4); page++) {
      const url = `${base}/contratacoes/publicacao?dataInicial=${d(s.from)}&dataFinal=${d(s.to)}&codigoModalidadeContratacao=${mod}&uf=${encodeURIComponent(s.uf.toUpperCase())}&pagina=${page}&tamanhoPagina=50`;
      let res;
      try { res = await httpRequest(url, { timeoutMs: ctx.timeoutMs, userAgent: ctx.userAgent, fetchImpl: ctx.fetchImpl }); }
      catch (e) { warnings.push(`PNCP modalidade ${mod} página ${page}: ${e instanceof Error ? e.message : String(e)}`); break; }
      if (res.status === 204) break;
      if (res.status >= 400) { warnings.push(`PNCP modalidade ${mod}: HTTP ${res.status}`); break; }
      let body: { data?: PncpRaw[]; totalPaginas?: number; paginasRestantes?: number };
      try { body = JSON.parse(res.text()) as typeof body; } catch { warnings.push(`PNCP modalidade ${mod}: resposta inválida`); break; }
      items.push(...(body.data ?? []));
      if (!body.data?.length || (body.paginasRestantes !== undefined && body.paginasRestantes <= 0) || (body.totalPaginas !== undefined && page >= body.totalPaginas)) break;
    }
  }
  return { items, warnings };
}
