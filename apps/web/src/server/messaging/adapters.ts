/**
 * Adapters de canal (WhatsApp Cloud API via fetch, e-mail via SMTP/nodemailer).
 * Regra da spec §18: nunca simular envio — se o provedor não confirmar, a
 * mensagem NÃO fica como enviada; sem provedor configurado, o fluxo é MANUAL
 * (link wa.me / mailto e confirmação pelo usuário).
 */
import nodemailer from 'nodemailer';
import { env } from '../env.js';

export interface SendInput {
  recipient: string;
  subject?: string | null;
  body: string;
}

export interface SendResult {
  providerName: string;
  providerMessageId: string | null;
  accepted: boolean;
  response: unknown;
}

export interface MessageAdapter {
  readonly channel: 'WHATSAPP' | 'EMAIL';
  readonly providerName: string;
  isConfigured(): boolean;
  send(input: SendInput): Promise<SendResult>;
  /** Link para envio manual (wa.me / mailto) quando não configurado. */
  manualLink(input: SendInput): string;
}

const digits = (v: string): string => v.replace(/\D/g, '');

/** Aceita tanto os nomes do env do web (WHATSAPP_PHONE_ID/TOKEN) quanto os legados (.env.example). */
function whatsappConfig(): { phoneId: string | undefined; token: string | undefined; apiUrl: string } {
  const c = env();
  const phoneId = c.WHATSAPP_PHONE_ID ?? process.env['WHATSAPP_PHONE_NUMBER_ID'];
  const token = c.WHATSAPP_TOKEN ?? process.env['WHATSAPP_ACCESS_TOKEN'];
  const apiUrl = (c.WHATSAPP_API_URL ?? 'https://graph.facebook.com/v21.0').replace(/\/+$/, '');
  return { phoneId, token, apiUrl };
}

export class WhatsAppCloudAdapter implements MessageAdapter {
  readonly channel = 'WHATSAPP' as const;
  readonly providerName = 'whatsapp-cloud';

  isConfigured(): boolean {
    const c = whatsappConfig();
    return Boolean(c.phoneId && c.token);
  }

  async send(input: SendInput): Promise<SendResult> {
    const c = whatsappConfig();
    const res = await fetch(`${c.apiUrl}/${c.phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: digits(input.recipient), type: 'text', text: { body: input.body, preview_url: false } }),
      cache: 'no-store',
    });
    const json = (await res.json().catch(() => null)) as { messages?: Array<{ id: string }>; error?: unknown } | null;
    const id = json?.messages?.[0]?.id ?? null;
    return { providerName: this.providerName, providerMessageId: id, accepted: res.ok && Boolean(id), response: json };
  }

  manualLink(input: SendInput): string {
    let to = digits(input.recipient);
    if (to.length <= 11) to = `55${to}`;
    return `https://wa.me/${to}?text=${encodeURIComponent(input.body)}`;
  }
}

export class SmtpAdapter implements MessageAdapter {
  readonly channel = 'EMAIL' as const;
  readonly providerName = 'smtp';

  isConfigured(): boolean {
    const c = env();
    return Boolean(c.SMTP_HOST && c.SMTP_FROM);
  }

  async send(input: SendInput): Promise<SendResult> {
    const c = env();
    const port = c.SMTP_PORT ?? 587;
    const transporter = nodemailer.createTransport({
      host: c.SMTP_HOST,
      port,
      secure: port === 465,
      auth: c.SMTP_USER ? { user: c.SMTP_USER, pass: c.SMTP_PASS } : undefined,
    });
    const info = await transporter.sendMail({ from: c.SMTP_FROM, to: input.recipient, subject: input.subject ?? '(sem assunto)', text: input.body });
    return { providerName: this.providerName, providerMessageId: info.messageId ?? null, accepted: (info.accepted?.length ?? 0) > 0, response: { accepted: info.accepted, rejected: info.rejected, response: info.response } };
  }

  manualLink(input: SendInput): string {
    return `mailto:${encodeURIComponent(input.recipient)}?subject=${encodeURIComponent(input.subject ?? '')}&body=${encodeURIComponent(input.body)}`;
  }
}

export function adapterFor(channel: 'WHATSAPP' | 'EMAIL'): MessageAdapter {
  return channel === 'WHATSAPP' ? new WhatsAppCloudAdapter() : new SmtpAdapter();
}
