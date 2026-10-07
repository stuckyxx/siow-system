import nodemailer from 'nodemailer';
import { env } from '../../../config/env.js';

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

/**
 * Adapter de canal. Regra da spec §18: nunca simular envio — se o provedor
 * não confirmar, a mensagem NÃO fica como enviada.
 */
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

  isConfigured(): boolean {
    const c = env();
    return Boolean(c.WHATSAPP_PHONE_NUMBER_ID && c.WHATSAPP_ACCESS_TOKEN);
  }

  async send(input: SendInput): Promise<SendResult> {
    const c = env();
    const res = await fetch(`https://graph.facebook.com/v21.0/${c.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: digits(input.recipient), type: 'text', text: { body: input.body, preview_url: false } }),
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
    const transporter = nodemailer.createTransport({
      host: c.SMTP_HOST,
      port: c.SMTP_PORT ?? 587,
      secure: (c.SMTP_PORT ?? 587) === 465,
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
