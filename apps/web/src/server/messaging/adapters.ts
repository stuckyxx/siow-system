/**
 * Adapters de canal (WhatsApp Cloud API via fetch, e-mail via SMTP/nodemailer), configurados pela
 * integração da organização (Administração → Integrações) com fallback nas variáveis de ambiente.
 * Regra da spec §18: nunca simular envio — se o provedor não confirmar, a mensagem NÃO fica como enviada;
 * sem provedor configurado (ou circuito aberto após falhas seguidas), o fluxo é MANUAL (wa.me / mailto).
 * Cada envio é registrado no log de integrações (sem segredos).
 */
import nodemailer from 'nodemailer';
import { call, resolve, type ResolvedConfig } from '../services/integrations.js';

export interface SendInput { recipient: string; subject?: string | null; body: string; referenceType?: string; referenceId?: string }
export interface SendResult { providerName: string; providerMessageId: string | null; accepted: boolean; response: unknown }
export interface MessageAdapter {
  readonly channel: 'WHATSAPP' | 'EMAIL';
  readonly providerName: string;
  isConfigured(): boolean;
  send(input: SendInput): Promise<SendResult>;
  /** Link para envio manual (wa.me / mailto) quando não configurado. */
  manualLink(input: SendInput): string;
}

const digits = (v: string): string => v.replace(/\D/g, '');

export class WhatsAppCloudAdapter implements MessageAdapter {
  readonly channel = 'WHATSAPP' as const;
  readonly providerName = 'whatsapp-cloud';
  constructor(private readonly cfg: ResolvedConfig) {}
  isConfigured(): boolean { return this.cfg.enabled && this.cfg.configured && !this.cfg.circuitOpen; }
  async send(input: SendInput): Promise<SendResult> {
    const c = this.cfg.config; const apiUrl = (c['apiUrl'] || 'https://graph.facebook.com/v21.0').replace(/\/+$/, '');
    return call('WHATSAPP', 'SEND', { request: { to: digits(input.recipient), length: input.body.length }, referenceType: input.referenceType, referenceId: input.referenceId }, async () => {
      const res = await fetch(`${apiUrl}/${c['phoneId']}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${c['token']}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to: digits(input.recipient), type: 'text', text: { body: input.body, preview_url: false } }), cache: 'no-store' });
      const json = (await res.json().catch(() => null)) as { messages?: Array<{ id: string }>; error?: unknown } | null;
      const id = json?.messages?.[0]?.id ?? null; const accepted = res.ok && Boolean(id);
      return { result: { providerName: this.providerName, providerMessageId: id, accepted, response: json }, response: { status: res.status, body: json }, ok: accepted };
    });
  }
  manualLink(input: SendInput): string { let to = digits(input.recipient); if (to.length <= 11) to = `55${to}`; return `https://wa.me/${to}?text=${encodeURIComponent(input.body)}`; }
}

export class SmtpAdapter implements MessageAdapter {
  readonly channel = 'EMAIL' as const;
  readonly providerName = 'smtp';
  constructor(private readonly cfg: ResolvedConfig) {}
  isConfigured(): boolean { return this.cfg.enabled && this.cfg.configured && !this.cfg.circuitOpen; }
  async send(input: SendInput): Promise<SendResult> {
    const c = this.cfg.config; const port = Number(c['port'] || 587);
    return call('EMAIL', 'SEND', { request: { to: input.recipient, subject: input.subject }, referenceType: input.referenceType, referenceId: input.referenceId }, async () => {
      const transporter = nodemailer.createTransport({ host: c['host'], port, secure: port === 465, auth: c['user'] ? { user: c['user'], pass: c['pass'] } : undefined });
      const info = await transporter.sendMail({ from: c['from'], to: input.recipient, subject: input.subject ?? '(sem assunto)', text: input.body });
      const accepted = (info.accepted?.length ?? 0) > 0;
      return { result: { providerName: this.providerName, providerMessageId: info.messageId ?? null, accepted, response: { accepted: info.accepted, rejected: info.rejected, response: info.response } }, response: { accepted: info.accepted, rejected: info.rejected }, ok: accepted };
    });
  }
  manualLink(input: SendInput): string { return `mailto:${encodeURIComponent(input.recipient)}?subject=${encodeURIComponent(input.subject ?? '')}&body=${encodeURIComponent(input.body)}`; }
}

export async function adapterFor(channel: 'WHATSAPP' | 'EMAIL'): Promise<MessageAdapter> {
  return channel === 'WHATSAPP' ? new WhatsAppCloudAdapter(await resolve('WHATSAPP')) : new SmtpAdapter(await resolve('EMAIL'));
}
