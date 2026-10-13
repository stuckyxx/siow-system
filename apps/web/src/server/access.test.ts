import { describe, expect, it } from 'vitest';
import type { OrgAccess } from '@siow/shared';
import { moduleAllowed, moduleForPath } from './access.js';

const base: OrgAccess = { planKey: 'X', planName: 'X', modules: [], readOnly: false, blockReason: null, subscriptionStatus: 'ACTIVE', trialEndsAt: null, limits: { maxUsers: null, maxEntities: null } };

describe('licenciamento por rota', () => {
  it('mapeia prefixos de rota para módulos; núcleo não tem módulo', () => {
    expect(moduleForPath('/api/comercial/opportunities')).toBe('COMERCIAL');
    expect(moduleForPath('/api/licitacoes/tenders')).toBe('LICITACOES');
    expect(moduleForPath('/api/atendimento/whatsapp/conversations')).toBe('ATENDIMENTO');
    expect(moduleForPath('/api/parceiros')).toBe('PARCEIROS');
    expect(moduleForPath('/api/financeiro/reports')).toBe('RELATORIOS');
    expect(moduleForPath('/api/bi/executive')).toBe('RELATORIOS');
    expect(moduleForPath('/api/integracoes/webhooks')).toBe('INTEGRACOES');
    expect(moduleForPath('/api/financeiro/invoices')).toBeNull();
    expect(moduleForPath('/api/users')).toBeNull();
  });
  it('lista vazia libera tudo; lista restrita bloqueia o que não está nela', () => {
    expect(moduleAllowed(base, 'COMERCIAL')).toBe(true);
    const basic = { ...base, modules: ['CADASTRO', 'FINANCEIRO', 'CONTRATOS', 'ATENDIMENTO'] };
    expect(moduleAllowed(basic, 'ATENDIMENTO')).toBe(true);
    expect(moduleAllowed(basic, 'COMERCIAL')).toBe(false);
    expect(moduleAllowed(basic, null)).toBe(true);
  });
});
