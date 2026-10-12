/**
 * Clicksign (API v1) como provedor de assinatura eletrônica: cria documento, signatários e lista,
 * consulta status, baixa o documento assinado e valida webhooks (HMAC-SHA256 no cabeçalho Content-Hmac).
 * Configuração vem de Administração → Integrações (segredos cifrados). Sem token, isConfigured() = false
 * e o fluxo continua manual (upload da OS assinada).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SignatureProvider, SignatureRequestState } from '../services/signature.js';
import { call, type ResolvedConfig } from '../services/integrations.js';

const STATUS_MAP: Record<string, SignatureRequestState> = { running: 'SENT', closed: 'SIGNED', canceled: 'CANCELLED', cancelled: 'CANCELLED', deadline: 'EXPIRED' };

export class ClicksignProvider implements SignatureProvider {
  readonly key = 'CLICKSIGN' as const;
  constructor(private readonly cfg: ResolvedConfig) {}
  private get base(): string { return (this.cfg.config['apiUrl'] || 'https://app.clicksign.com').replace(/\/+$/, ''); }
  private url(path: string): string { return `${this.base}${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(this.cfg.config['accessToken'] ?? '')}`; }
  isConfigured(): boolean { return this.cfg.enabled && this.cfg.configured && !this.cfg.circuitOpen; }

  async createRequest(input: { documentBuffer: Buffer; fileName: string; signers: Array<{ name: string; email?: string; role?: string }>; deadlineDays?: number }): Promise<{ providerRequestId: string; status: 'SENT' }> {
    return call('SIGNATURE', 'CREATE_REQUEST', { request: { fileName: input.fileName, signers: input.signers.map((s) => s.name) } }, async () => {
      const mime = input.fileName.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream';
      const doc = await this.post('/api/v1/documents', { document: { path: `/siow/${Date.now()}-${input.fileName.replace(/[^\w.-]+/g, '_')}`, content_base64: `data:${mime};base64,${input.documentBuffer.toString('base64')}`, deadline_at: new Date(Date.now() + (input.deadlineDays ?? 15) * 86_400_000).toISOString(), auto_close: true, locale: 'pt-BR', sequence_enabled: false } });
      const key = String((doc as { document?: { key?: string } }).document?.key ?? '');
      if (!key) throw new Error('Clicksign não devolveu a chave do documento');
      for (const s of input.signers) {
        if (!s.email) throw new Error(`Signatário ${s.name} sem e-mail`);
        const signer = await this.post('/api/v1/signers', { signer: { email: s.email, name: s.name, auths: ['email'], delivery: 'email' } });
        const signerKey = String((signer as { signer?: { key?: string } }).signer?.key ?? '');
        await this.post('/api/v1/lists', { list: { document_key: key, signer_key: signerKey, sign_as: 'sign', message: `Por favor, assine a ordem de serviço ${input.fileName}.` } });
      }
      return { result: { providerRequestId: key, status: 'SENT' as const }, response: { documentKey: key } };
    });
  }
  async getStatus(providerRequestId: string): Promise<{ status: SignatureRequestState; evidence?: unknown }> {
    return call('SIGNATURE', 'STATUS', { request: { documentKey: providerRequestId } }, async () => {
      const res = await fetch(this.url(`/api/v1/documents/${providerRequestId}`), { cache: 'no-store' });
      const json = (await res.json().catch(() => null)) as { document?: { status?: string; signers?: unknown; downloads?: { signed_file_url?: string } } } | null;
      if (!res.ok) throw new Error(`Clicksign respondeu ${res.status}`);
      const status = STATUS_MAP[String(json?.document?.status ?? '')] ?? 'SENT';
      return { result: { status, evidence: { signers: json?.document?.signers, status: json?.document?.status } }, response: { status: json?.document?.status } };
    });
  }
  async downloadSigned(providerRequestId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    return call('SIGNATURE', 'DOWNLOAD', { request: { documentKey: providerRequestId } }, async () => {
      const res = await fetch(this.url(`/api/v1/documents/${providerRequestId}`), { cache: 'no-store' });
      const json = (await res.json().catch(() => null)) as { document?: { downloads?: { signed_file_url?: string } } } | null;
      const fileUrl = json?.document?.downloads?.signed_file_url;
      if (!res.ok || !fileUrl) throw new Error('Documento assinado ainda não disponível');
      const f = await fetch(fileUrl, { cache: 'no-store' });
      if (!f.ok) throw new Error(`Download falhou (${f.status})`);
      return { result: { buffer: Buffer.from(await f.arrayBuffer()), mimeType: f.headers.get('content-type') ?? 'application/pdf' }, response: { size: Number(f.headers.get('content-length') ?? 0) } };
    });
  }
  parseWebhook(headers: Record<string, string | string[] | undefined>, body: unknown, rawBody?: string): { providerRequestId: string; status: SignatureRequestState; evidence?: unknown } | null {
    const secret = this.cfg.config['webhookSecret'];
    if (secret && rawBody) {
      const given = String(headers['content-hmac'] ?? headers['Content-Hmac'] ?? '').replace(/^sha256=/, '');
      const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
      if (!given || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return null;
    }
    const b = body as { event?: { name?: string; data?: { document?: { key?: string; status?: string } } }; document?: { key?: string; status?: string } } | null;
    const doc = b?.event?.data?.document ?? b?.document;
    if (!doc?.key) return null;
    const name = b?.event?.name ?? '';
    const status: SignatureRequestState = name === 'auto_close' || name === 'close' || doc.status === 'closed' ? 'SIGNED' : name === 'cancel' ? 'CANCELLED' : name === 'deadline' ? 'EXPIRED' : name === 'refusal' ? 'DECLINED' : 'VIEWED';
    return { providerRequestId: doc.key, status, evidence: { event: name, status: doc.status } };
  }
  private async post(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(this.url(path), { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
    const json = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) throw new Error(`Clicksign ${path} respondeu ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
    return json;
  }
}
