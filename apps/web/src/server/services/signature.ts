/**
 * Interface de assinatura eletrônica (spec §21). O MVP usa MANUAL_UPLOAD
 * (OS assinada enviada pelo usuário, com checksum, signatários e auditoria).
 * Integrações (Clicksign, DocuSign, gov.br) implementam esta interface e
 * são registradas no registry — o serviço de OS não muda.
 */
import type { SignatureProvider as SignatureProviderKey } from '@siow/db';

export type SignatureRequestState = 'SENT' | 'VIEWED' | 'SIGNED' | 'DECLINED' | 'EXPIRED' | 'CANCELLED';

export interface SignatureProvider {
  readonly key: SignatureProviderKey;
  isConfigured(): boolean;
  /** Envia o documento para assinatura; devolve o id externo da solicitação. */
  createRequest(input: { documentBuffer: Buffer; fileName: string; signers: Array<{ name: string; email?: string; role?: string }>; deadlineDays?: number }): Promise<{ providerRequestId: string; status: 'SENT' }>;
  /** Consulta status (polling) — complementa webhooks. */
  getStatus(providerRequestId: string): Promise<{ status: SignatureRequestState; evidence?: unknown }>;
  /** Baixa o documento final assinado. */
  downloadSigned(providerRequestId: string): Promise<{ buffer: Buffer; mimeType: string }>;
  /** Valida e interpreta um webhook do provedor. */
  parseWebhook(headers: Record<string, string | string[] | undefined>, body: unknown, rawBody?: string): { providerRequestId: string; status: SignatureRequestState; evidence?: unknown } | null;
}

const registry = new Map<SignatureProviderKey, SignatureProvider>();

export function registerSignatureProvider(p: SignatureProvider): void {
  registry.set(p.key, p);
}

export function getSignatureProvider(key: SignatureProviderKey): SignatureProvider | null {
  return registry.get(key) ?? null;
}

/** Primeiro provedor configurado (ou null → fluxo manual). Provedores registrados em código têm prioridade; depois, a integração da organização. */
export async function getConfiguredSignatureProvider(): Promise<SignatureProvider | null> {
  for (const p of registry.values()) if (p.isConfigured()) return p;
  const { resolve } = await import('./integrations.js');
  const cfg = await resolve('SIGNATURE');
  if (cfg.provider === 'clicksign' && cfg.enabled && cfg.configured && !cfg.circuitOpen) { const { ClicksignProvider } = await import('../integrations/clicksign.js'); return new ClicksignProvider(cfg); }
  return null;
}
/** Instancia o provedor pela chave (para webhooks e polling), mesmo com circuito aberto. */
export async function providerByKey(key: SignatureProviderKey): Promise<SignatureProvider | null> {
  const p = registry.get(key); if (p) return p;
  if (key === 'CLICKSIGN') { const { resolve } = await import('./integrations.js'); const cfg = await resolve('SIGNATURE'); if (cfg.provider === 'clicksign' && cfg.configured) { const { ClicksignProvider } = await import('../integrations/clicksign.js'); return new ClicksignProvider(cfg); } }
  return null;
}
