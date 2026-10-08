import type { BillingProvider, ProviderKey } from '../types.js';
import { AssesiPortalProvider } from './assesi/provider.js';
import { AdoisPortalProvider } from './adois/provider.js';

/**
 * Registro de providers. Para adicionar um novo (ex.: API oficial), basta
 * implementar BillingProvider e registrá-lo aqui — o restante do sistema
 * (worker de sync, API, frontend) não muda.
 *
 * Ordem de prioridade prevista na especificação:
 *   1. ASSESI_API   — API oficial (ainda inexistente; placeholder)
 *   2. ASSESI_PORTAL— HTTP + parser HTML (implementado)
 *      ADOIS_PORTAL — Portal do Cliente da Adois, links de entidade (t=1) e de parceiro (t=2)
 *   3. Browser      — Playwright, apenas se o portal passar a exigir JS/sessão
 */
const providers = new Map<ProviderKey, BillingProvider>();
providers.set('ASSESI_PORTAL', new AssesiPortalProvider());
providers.set('ADOIS_PORTAL', new AdoisPortalProvider());

export function registerProvider(provider: BillingProvider): void {
  providers.set(provider.key, provider);
}

export function getProvider(key: ProviderKey): BillingProvider {
  const p = providers.get(key);
  if (!p) throw new Error(`Provider não configurado: ${key}`);
  return p;
}

export function listProviders(): ProviderKey[] {
  return [...providers.keys()];
}
