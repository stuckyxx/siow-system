/** Consultas públicas (CNPJ, IBGE) com log de integração; somente leitura. */
import { fetchCnpj, fetchIbgeMunicipalities, type CnpjInfo, type IbgeMunicipality } from '@siow/integrations';
import { badRequest } from '../http.js';
import { call, resolve } from './integrations.js';

const ctx = { timeoutMs: 15_000, userAgent: 'SiowSystem/1.0 (+integracoes)' };
const ibgeCache = new Map<string, { at: number; value: IbgeMunicipality[] }>();

export async function lookupCnpj(cnpj: string): Promise<CnpjInfo> {
  const d = cnpj.replace(/\D/g, ''); if (d.length !== 14) throw badRequest('CNPJ deve ter 14 dígitos');
  const cfg = await resolve('CNPJ'); if (!cfg.enabled) throw badRequest('Consulta de CNPJ desativada');
  return call('CNPJ', 'FETCH', { request: { cnpj: d } }, async () => { const r = await fetchCnpj(d, { ...ctx, apiUrl: cfg.config['apiUrl'] }); return { result: r, response: { name: r.name, uf: r.uf } }; });
}
export async function municipalities(uf: string): Promise<IbgeMunicipality[]> {
  const k = uf.toUpperCase(); const hit = ibgeCache.get(k); if (hit && Date.now() - hit.at < 24 * 3_600_000) return hit.value;
  const cfg = await resolve('IBGE'); if (!cfg.enabled) throw badRequest('Consulta ao IBGE desativada');
  const v = await call('IBGE', 'FETCH', { request: { uf: k } }, async () => { const r = await fetchIbgeMunicipalities(k, ctx); return { result: r, response: { count: r.length } }; });
  ibgeCache.set(k, { at: Date.now(), value: v }); return v;
}
