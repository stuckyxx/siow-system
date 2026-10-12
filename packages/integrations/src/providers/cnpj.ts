/**
 * Consulta de CNPJ por fonte pública autorizada (BrasilAPI → dados cadastrais da Receita Federal).
 * Somente leitura; sem credenciais.
 */
import { httpRequest } from '../http/client.js';
import type { ProviderContext } from '../types.js';

export interface CnpjInfo { cnpj: string; name: string; tradeName: string | null; municipality: string | null; uf: string | null; ibgeCode: string | null; status: string | null; openedAt: string | null; legalNature: string | null; email: string | null; phone: string | null; address: string | null; zip: string | null }

export async function fetchCnpj(cnpj: string, ctx: Pick<ProviderContext, 'timeoutMs' | 'userAgent' | 'fetchImpl'> & { apiUrl?: string }): Promise<CnpjInfo> {
  const d = cnpj.replace(/\D/g, '');
  if (d.length !== 14) throw new Error('CNPJ deve ter 14 dígitos');
  const base = (ctx.apiUrl || 'https://brasilapi.com.br/api/cnpj/v1').replace(/\/+$/, '');
  const res = await httpRequest(`${base}/${d}`, { timeoutMs: ctx.timeoutMs, userAgent: ctx.userAgent, fetchImpl: ctx.fetchImpl, headers: { Accept: 'application/json' } });
  if (res.status === 404) throw new Error('CNPJ não encontrado na base pública');
  if (res.status >= 400) throw new Error(`Consulta de CNPJ falhou (HTTP ${res.status})`);
  const j = JSON.parse(res.text()) as Record<string, unknown>;
  const s = (k: string): string | null => (j[k] == null || j[k] === '' ? null : String(j[k]));
  return { cnpj: d, name: s('razao_social') ?? '', tradeName: s('nome_fantasia'), municipality: s('municipio'), uf: s('uf'), ibgeCode: s('codigo_municipio_ibge'), status: s('descricao_situacao_cadastral'), openedAt: s('data_inicio_atividade'), legalNature: s('natureza_juridica'), email: s('email'), phone: s('ddd_telefone_1'), address: [s('descricao_tipo_de_logradouro'), s('logradouro'), s('numero'), s('bairro')].filter(Boolean).join(' ') || null, zip: s('cep') };
}
