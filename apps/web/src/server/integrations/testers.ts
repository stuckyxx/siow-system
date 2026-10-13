/** Testes de conexão por integração: chamada real e barata ao provedor; nunca envia mensagens nem cria documentos. */
import nodemailer from 'nodemailer';
import { fetchIbgeMunicipalities, fetchCnpj, fetchPncpPublications, fetchComprasGov } from '@siow/integrations';
import type { IntegrationKey, ResolvedConfig } from '../services/integrations.js';
import { todayIso, addDaysIso } from '@siow/shared';

const ctx = { timeoutMs: 15_000, userAgent: 'SiowSystem/1.0 (+integracoes)' };

export async function runTest(key: IntegrationKey, cfg: ResolvedConfig): Promise<{ ok: boolean; message: string; details?: unknown }> {
  const c = cfg.config;
  switch (key) {
    case 'WHATSAPP': {
      const apiUrl = (c['apiUrl'] || 'https://graph.facebook.com/v21.0').replace(/\/+$/, '');
      const res = await fetch(`${apiUrl}/${c['phoneId']}?fields=display_phone_number,verified_name,quality_rating`, { headers: { Authorization: `Bearer ${c['token']}` }, cache: 'no-store' });
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      return res.ok ? { ok: true, message: `Número ${String(json?.['display_phone_number'] ?? '')} (${String(json?.['verified_name'] ?? '')}) · qualidade ${String(json?.['quality_rating'] ?? '—')}`, details: json } : { ok: false, message: `Meta respondeu ${res.status}: ${String((json?.['error'] as { message?: string } | undefined)?.message ?? 'erro')}`, details: json };
    }
    case 'EMAIL': {
      const port = Number(c['port'] || 587);
      const t = nodemailer.createTransport({ host: c['host'], port, secure: port === 465, auth: c['user'] ? { user: c['user'], pass: c['pass'] } : undefined, connectionTimeout: 10_000 });
      await t.verify();
      return { ok: true, message: `Conexão SMTP com ${c['host']}:${port} verificada` };
    }
    case 'SIGNATURE': {
      const apiUrl = (c['apiUrl'] || 'https://app.clicksign.com').replace(/\/+$/, '');
      const res = await fetch(`${apiUrl}/api/v1/accounts?access_token=${encodeURIComponent(c['accessToken'] ?? '')}`, { cache: 'no-store' });
      const json = (await res.json().catch(() => null)) as unknown;
      return res.ok ? { ok: true, message: 'Token da Clicksign válido', details: json } : { ok: false, message: `Clicksign respondeu ${res.status}`, details: json };
    }
    case 'CNPJ': { const r = await fetchCnpj('06989347000195', { ...ctx, apiUrl: c['apiUrl'] }); return { ok: true, message: `Consulta ok: ${r.name}`, details: r }; }
    case 'IBGE': { const r = await fetchIbgeMunicipalities('MA', ctx); return { ok: r.length > 0, message: `${r.length} municípios do MA recebidos` }; }
    case 'PNCP': { const r = await fetchPncpPublications({ uf: 'MA', from: addDaysIso(todayIso(), -3), to: todayIso(), modalities: [6], maxPages: 1 }, { ...ctx, apiUrl: c['apiUrl'] }); return { ok: true, message: `${r.items.length} publicações nos últimos 3 dias (MA)${r.warnings.length ? ` · avisos: ${r.warnings.join('; ')}` : ''}` }; }
    case 'SPEECH': {
      const apiUrl = (c['apiUrl'] || 'https://api.openai.com/v1').replace(/\/+$/, '');
      const res = await fetch(`${apiUrl}/models`, { headers: { Authorization: `Bearer ${c['apiKey']}` }, cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return { ok: false, message: `Provedor respondeu HTTP ${res.status} (verifique a URL e a chave)` };
      return { ok: true, message: `Conexão ok · modelo ${c['model'] || 'whisper-1'}` };
    }
    case 'COMPRASGOV': { const r = await fetchComprasGov({ uf: 'MA', from: addDaysIso(todayIso(), -3), to: todayIso(), modalities: [6], maxPages: 1 }, { ...ctx, apiUrl: c['apiUrl'] }); return { ok: true, message: `${r.items.length} contratações nos últimos 3 dias (MA)${r.warnings.length ? ` · avisos: ${r.warnings.join('; ')}` : ''}` }; }
    default: return { ok: false, message: 'Teste não disponível' };
  }
}
