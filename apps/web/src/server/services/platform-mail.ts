/**
 * E-mails transacionais da plataforma (Fase 11): boas-vindas, fatura emitida, fatura vencida, bloqueio e reativação.
 * Enviados pela integração de e-mail da organização padrão (Siow), em pt-BR, para os administradores da organização
 * destinatária. Nunca simula envio: sem provedor configurado, registra no log e segue (o processo de cobrança não depende do e-mail).
 */
import { prismaPlatform } from '../db.js';
import { runWithOrg } from '../tenant.js';
import { adapterFor } from '../messaging/adapters.js';

export const DEFAULT_ORG_ID = '7a1b5c3e-5e1f-4a4e-8c0d-000000000001';
const brl = (v: { toString(): string }) => Number(v.toString()).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dateBr = (d: Date) => d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });

export type PlatformMailKind = 'WELCOME' | 'INVOICE_CREATED' | 'INVOICE_OVERDUE' | 'ORG_BLOCKED' | 'ORG_REACTIVATED';

async function recipients(organizationId: string, extra: string[] = []): Promise<string[]> {
  const admins = await prismaPlatform.user.findMany({ where: { organizationId, isActive: true, deletedAt: null, roles: { some: { role: { name: 'ADMINISTRADOR' } } } }, select: { email: true } });
  return Array.from(new Set([...admins.map((a) => a.email), ...extra].filter((e) => e && !e.endsWith('.local'))));
}

function compose(kind: PlatformMailKind, p: { orgName: string; productName: string; appUrl: string; period?: string; amount?: string; dueDate?: string; reason?: string; adminEmail?: string; trialEndsAt?: string }): { subject: string; body: string } {
  const foot = `\n\n—\n${p.productName} · Siow System Tecnologia\nEste é um e-mail automático da plataforma.`;
  switch (kind) {
    case 'WELCOME': return { subject: `Bem-vindo ao ${p.productName} — ${p.orgName}`, body: `Olá!\n\nA organização "${p.orgName}" foi criada no ${p.productName}.\nAcesse: ${p.appUrl}/login com o e-mail ${p.adminEmail ?? ''} e a senha provisória informada; o sistema pedirá uma nova senha no primeiro acesso.${p.trialEndsAt ? `\nPeríodo de teste gratuito até ${p.trialEndsAt}.` : ''}\n\nManual do usuário e do administrador estão disponíveis com a equipe Siow.${foot}` };
    case 'INVOICE_CREATED': return { subject: `Fatura ${p.period} emitida — ${p.orgName}`, body: `Olá!\n\nA fatura da assinatura do ${p.productName} referente a ${p.period} foi emitida.\nValor: ${p.amount}\nVencimento: ${p.dueDate}\n\nApós o pagamento, envie o comprovante à Siow para registro. Em caso de dúvida, responda a este e-mail.${foot}` };
    case 'INVOICE_OVERDUE': return { subject: `Fatura ${p.period} vencida — ${p.orgName}`, body: `Olá!\n\nA fatura ${p.period} (${p.amount}), com vencimento em ${p.dueDate}, consta como não paga.\nRegularize para evitar o bloqueio de alterações no sistema (a consulta permanece liberada).${foot}` };
    case 'ORG_BLOCKED': return { subject: `Acesso em modo somente leitura — ${p.orgName}`, body: `Olá!\n\nA organização "${p.orgName}" entrou em modo somente leitura.\nMotivo: ${p.reason ?? 'pendência financeira'}.\nOs dados continuam disponíveis para consulta; alterações voltam a ser liberadas assim que o pagamento for registrado.${foot}` };
    case 'ORG_REACTIVATED': return { subject: `Acesso reativado — ${p.orgName}`, body: `Olá!\n\nO pagamento foi registrado e a organização "${p.orgName}" voltou ao acesso completo. Obrigado!${foot}` };
  }
}

/** Envia (melhor esforço) para os administradores da organização. Devolve quantos destinatários aceitos. */
export async function sendPlatformMail(kind: PlatformMailKind, organizationId: string, extra: Partial<{ period: string; amount: { toString(): string }; dueDate: Date; reason: string; adminEmail: string; trialEndsAt: Date | null }> = {}): Promise<number> {
  try {
    const org = await prismaPlatform.organization.findUnique({ where: { id: organizationId }, select: { name: true, branding: true } });
    if (!org) return 0;
    const to = await recipients(organizationId, extra.adminEmail ? [extra.adminEmail] : []);
    if (!to.length) return 0;
    const productName = ((org.branding as Record<string, unknown>)?.['productName'] as string | undefined) || 'Siow System';
    const msg = compose(kind, { orgName: org.name, productName, appUrl: process.env['APP_URL'] ?? 'https://siow-system-siowsystemtecnologia-5452.vercel.app', period: extra.period, amount: extra.amount ? brl(extra.amount) : undefined, dueDate: extra.dueDate ? dateBr(extra.dueDate) : undefined, reason: extra.reason, adminEmail: extra.adminEmail, trialEndsAt: extra.trialEndsAt ? dateBr(extra.trialEndsAt) : undefined });
    // O provedor de e-mail é o da organização padrão (Siow); o envio roda no contexto dela para o log de integrações.
    return await runWithOrg(DEFAULT_ORG_ID, async () => {
      const adapter = await adapterFor('EMAIL');
      if (!adapter.isConfigured()) { console.warn(`[platform-mail] e-mail não configurado; ${kind} para ${org.name} não enviado`); return 0; }
      let ok = 0;
      for (const r of to) { const res = await adapter.send({ recipient: r, subject: msg.subject, body: msg.body, referenceType: 'platform', referenceId: organizationId }).catch(() => null); if (res?.accepted) ok++; }
      return ok;
    });
  } catch (e) { console.error('[platform-mail] falhou', e); return 0; }
}
