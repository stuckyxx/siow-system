import { describe, expect, it } from 'vitest';
process.env.DATABASE_URL ??= 'postgresql://x:y@localhost/z';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-0123456789abcdef0123456789';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-0123456789abcdef012345678';
const { sensitiveReason, actionToken, API_CATALOG, isConfigured } = await import('./services/assistant.js');

describe('assistente — classificação de ações sensíveis', () => {
  it('consultas nunca são sensíveis', () => {
    expect(sensitiveReason('GET', '/financeiro/invoices')).toBeNull();
    expect(sensitiveReason('GET', '/users')).toBeNull();
  });
  it('cadastros comuns não exigem confirmação', () => {
    expect(sensitiveReason('POST', '/financeiro/entities')).toBeNull();
    expect(sensitiveReason('POST', '/financeiro/contracts')).toBeNull();
    expect(sensitiveReason('POST', '/comercial/opportunities')).toBeNull();
    expect(sensitiveReason('POST', '/financeiro/invoices')).toBeNull(); // nota manual já exige justificativa
    expect(sensitiveReason('PATCH', '/financeiro/entities/abc')).toBeNull();
  });
  it('exclusões, financeiro, envios e administração exigem confirmação', () => {
    expect(sensitiveReason('DELETE', '/financeiro/entities/abc')).toMatch(/Exclusão/);
    expect(sensitiveReason('PATCH', '/financeiro/invoices/abc/override')).toMatch(/financeira/);
    expect(sensitiveReason('POST', '/financeiro/invoices/bulk-status')).toMatch(/financeira/);
    expect(sensitiveReason('POST', '/financeiro/messages/send')).toBeTruthy();
    expect(sensitiveReason('POST', '/financeiro/sync/all')).toBeTruthy();
    expect(sensitiveReason('POST', '/comercial/opportunities/abc/win')).toBeTruthy();
    expect(sensitiveReason('POST', '/atendimento/campanhas/abc/run')).toBeTruthy();
    expect(sensitiveReason('POST', '/parceiros/commissions/pay')).toBeTruthy();
    expect(sensitiveReason('POST', '/users')).toMatch(/Administração/);
    expect(sensitiveReason('PUT', '/settings/branding')).toMatch(/Administração/);
  });
});

describe('assistente — token de confirmação', () => {
  it('é determinístico e independente da ordem das chaves do corpo', () => {
    const a = actionToken('u1', 'POST', '/x', { b: 1, a: 'z' });
    const b = actionToken('u1', 'POST', '/x', { a: 'z', b: 1 });
    expect(a).toBe(b);
    expect(a).toHaveLength(24);
  });
  it('muda com usuário, método, caminho ou corpo', () => {
    const base = actionToken('u1', 'POST', '/x', { a: 1 });
    expect(actionToken('u2', 'POST', '/x', { a: 1 })).not.toBe(base);
    expect(actionToken('u1', 'DELETE', '/x', { a: 1 })).not.toBe(base);
    expect(actionToken('u1', 'POST', '/y', { a: 1 })).not.toBe(base);
    expect(actionToken('u1', 'POST', '/x', { a: 2 })).not.toBe(base);
  });
});

describe('assistente — catálogo e configuração', () => {
  it('catálogo cobre os módulos principais', () => {
    for (const k of ['/financeiro/entities', '/financeiro/contracts', '/financeiro/invoices', '/comercial/opportunities', '/licitacoes', '/atendimento/tickets', '/parceiros', '/financeiro/tasks', '/integracoes/lookup/ibge/municipios']) expect(API_CATALOG).toContain(k);
  });
  it('sem ANTHROPIC_API_KEY o assistente se declara não configurado', () => {
    const prev = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
    expect(isConfigured()).toBe(false);
    if (prev) process.env.ANTHROPIC_API_KEY = prev;
  });
});
