/**
 * Webhooks de entrada: WhatsApp (verificação, status de entrega e mensagens recebidas → notificação e chamado)
 * e assinatura eletrônica (status → OS). Sem usuário autenticado: rodam em modo plataforma, resolvendo a
 * organização pela integração correspondente. Tudo é registrado no log de integrações.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { prismaPlatform } from '../db.js';
import { runWithOrg } from '../tenant.js';
import { log, resolve } from './integrations.js';
import { providerByKey } from './signature.js';
import { applySignatureUpdate } from './service-orders.js';
import { applyStatus, ingestInbound } from './whatsapp.js';

/** Organizações com a integração WHATSAPP ativa (ou todas, para fallback por env). */
async function orgsWith(key: string): Promise<string[]> {
  const rows = await prismaPlatform.integration.findMany({ where: { key, isEnabled: true }, select: { organizationId: true } });
  if (rows.length) return rows.map((r) => r.organizationId);
  return (await prismaPlatform.organization.findMany({ where: { deletedAt: null, status: { not: 'SUSPENDED' } }, select: { id: true } })).map((o) => o.id);
}

export async function verifyWhatsAppWebhook(mode: string | null, token: string | null, challenge: string | null): Promise<{ ok: boolean; challenge: string }> {
  if (mode !== 'subscribe' || !token) return { ok: false, challenge: '' };
  for (const org of await orgsWith('WHATSAPP')) {
    const ok = await runWithOrg(org, async () => { const c = await resolve('WHATSAPP'); return Boolean(c.config['verifyToken']) && c.config['verifyToken'] === token; });
    if (ok) return { ok: true, challenge: challenge ?? '' };
  }
  return { ok: false, challenge: '' };
}

interface WaPayload { entry?: Array<{ changes?: Array<{ value?: { metadata?: { phone_number_id?: string }; statuses?: Array<{ id: string; status: string; timestamp?: string; errors?: unknown }>; messages?: Array<{ from: string; id: string; timestamp?: string; type: string; text?: { body: string } }>; contacts?: Array<{ wa_id: string; profile?: { name?: string } }> } }> }> }

export async function handleWhatsAppWebhook(raw: string, signature: string | null): Promise<{ ok: boolean; statuses: number; messages: number; tickets: number; message?: string }> {
  let body: WaPayload; try { body = JSON.parse(raw) as WaPayload; } catch { return { ok: false, statuses: 0, messages: 0, tickets: 0, message: 'JSON inválido' }; }
  const phoneId = body.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id ?? null;
  // encontra a organização pelo phone_number_id; valida a assinatura (X-Hub-Signature-256) quando o app secret estiver configurado
  for (const org of await orgsWith('WHATSAPP')) {
    const r = await runWithOrg(org, async () => {
      const c = await resolve('WHATSAPP');
      if (!c.configured || (phoneId && c.config['phoneId'] !== phoneId)) return null;
      if (c.config['appSecret']) {
        const expected = `sha256=${createHmac('sha256', c.config['appSecret']).update(raw).digest('hex')}`;
        if (!signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) { await log({ key: 'WHATSAPP', provider: 'whatsapp-cloud', action: 'WEBHOOK_IN', status: 'FAILED', error: 'Assinatura inválida' }); return { ok: false, statuses: 0, messages: 0, tickets: 0, message: 'Assinatura inválida' }; }
      }
      let statuses = 0, messages = 0, tickets = 0;
      for (const e of body.entry ?? []) for (const ch of e.changes ?? []) {
        const v = ch.value ?? {};
        for (const s of v.statuses ?? []) { if (await applyStatus(s.id, s.status, s.errors)) statuses += 1; }
        for (const m of v.messages ?? []) {
          const name = v.contacts?.find((x) => x.wa_id === m.from)?.profile?.name ?? null;
          const r = await ingestInbound(m as Parameters<typeof ingestInbound>[0], name);
          if (!r.duplicate) messages += 1; if (r.newTicket) tickets += 1;
        }
      }
      await log({ key: 'WHATSAPP', provider: 'whatsapp-cloud', action: 'WEBHOOK_IN', status: 'OK', request: { statuses, messages }, response: { tickets } });
      return { ok: true, statuses, messages, tickets };
    });
    if (r) return r;
  }
  return { ok: true, statuses: 0, messages: 0, tickets: 0, message: 'Nenhuma organização com este número' };
}

export async function handleSignatureWebhook(provider: string, headers: Record<string, string>, raw: string): Promise<{ ok: boolean; applied: boolean; message?: string }> {
  const key = provider.toUpperCase() === 'CLICKSIGN' ? 'CLICKSIGN' : null;
  if (!key) return { ok: false, applied: false, message: 'Provedor desconhecido' };
  let body: unknown; try { body = JSON.parse(raw); } catch { return { ok: false, applied: false, message: 'JSON inválido' }; }
  for (const org of await orgsWith('SIGNATURE')) {
    const r = await runWithOrg(org, async () => {
      const p = await providerByKey(key); if (!p) return null;
      const parsed = p.parseWebhook(headers, body, raw);
      if (!parsed) { await log({ key: 'SIGNATURE', provider: 'clicksign', action: 'WEBHOOK_IN', status: 'FAILED', error: 'Assinatura inválida ou payload não reconhecido' }); return { ok: false, applied: false, message: 'Assinatura inválida' }; }
      const a = await applySignatureUpdate(parsed.providerRequestId, parsed.status, parsed.evidence);
      if (!a.serviceOrderId) return null; // pedido não é desta organização
      await log({ key: 'SIGNATURE', provider: 'clicksign', action: 'WEBHOOK_IN', status: 'OK', request: { providerRequestId: parsed.providerRequestId, status: parsed.status }, referenceType: 'serviceOrder', referenceId: a.serviceOrderId });
      return { ok: true, applied: a.applied };
    });
    if (r) return r;
  }
  return { ok: true, applied: false, message: 'Solicitação não encontrada' };
}
