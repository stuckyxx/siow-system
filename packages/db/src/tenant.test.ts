import { describe, expect, it } from 'vitest';
import { applyTenantArgs, TenantContextError } from './tenant.js';

const ORG = 'org-a';

describe('applyTenantArgs — isolamento por organização', () => {
  it('injeta organizationId no where de leituras de modelos tenant', () => {
    expect(applyTenantArgs('Entity', 'findMany', { where: { uf: 'MA' } }, ORG)).toEqual({ where: { uf: 'MA', organizationId: ORG } });
    expect(applyTenantArgs('Invoice', 'count', {}, ORG)).toEqual({ where: { organizationId: ORG } });
    expect(applyTenantArgs('Invoice', 'findUnique', { where: { entityId_number: { entityId: 'e', number: '1' } } }, ORG)).toEqual({ where: { entityId_number: { entityId: 'e', number: '1' }, organizationId: ORG } });
  });
  it('preenche organizationId em create/createMany/upsert', () => {
    expect(applyTenantArgs('Entity', 'create', { data: { name: 'X' } }, ORG)).toEqual({ data: { name: 'X', organizationId: ORG } });
    expect(applyTenantArgs('Invoice', 'createMany', { data: [{ number: '1' }, { number: '2' }] }, ORG)).toEqual({ data: [{ number: '1', organizationId: ORG }, { number: '2', organizationId: ORG }] });
    const up = applyTenantArgs('Contract', 'upsert', { where: { id: 'c' }, create: { number: '1' }, update: {} }, ORG);
    expect(up).toEqual({ where: { id: 'c', organizationId: ORG }, create: { number: '1', organizationId: ORG }, update: {} });
  });
  it('não deixa o chamador sobrescrever a organização do contexto', () => {
    expect(applyTenantArgs('Entity', 'findMany', { where: { organizationId: 'org-b' } }, ORG)).toEqual({ where: { organizationId: ORG } });
    // em create, o contexto vence: organizationId do chamador é ignorado
    expect(applyTenantArgs('Entity', 'create', { data: { organizationId: 'org-b', name: 'X' } }, ORG)).toEqual({ data: { name: 'X', organizationId: ORG } });
  });
  it('filtra modelos filhos pela relação com o pai', () => {
    expect(applyTenantArgs('InvoiceEvent', 'findMany', { where: { type: 'CREATED' } }, ORG)).toEqual({ where: { type: 'CREATED', invoice: { organizationId: ORG } } });
    expect(applyTenantArgs('CertificateVersion', 'findMany', {}, ORG)).toEqual({ where: { certificate: { organizationId: ORG } } });
    expect(applyTenantArgs('ContractAmendment', 'deleteMany', { where: { contractId: 'c' } }, ORG)).toEqual({ where: { contractId: 'c', contract: { organizationId: ORG } } });
  });
  it('mantém filtros já informados na relação com o pai', () => {
    expect(applyTenantArgs('TenderDeadline', 'findMany', { where: { done: false, tender: { deletedAt: null } } }, ORG)).toEqual({ where: { done: false, tender: { deletedAt: null, organizationId: ORG } } });
    expect(applyTenantArgs('TenderDeadline', 'findMany', { where: { tender: { organizationId: 'outra' } } }, ORG)).toEqual({ where: { tender: { organizationId: ORG } } });
  });

  it('não toca em modelos globais', () => {
    expect(applyTenantArgs('Permission', 'findMany', {}, ORG)).toEqual({});
    expect(applyTenantArgs('Setting', 'findUnique', { where: { key: 'x' } }, null)).toEqual({ where: { key: 'x' } });
    expect(applyTenantArgs('Organization', 'create', { data: { name: 'o' } }, null)).toEqual({ data: { name: 'o' } });
  });
  it('recusa operação sem contexto, salvo em modo plataforma', () => {
    expect(() => applyTenantArgs('Entity', 'findMany', {}, null)).toThrow(TenantContextError);
    expect(() => applyTenantArgs('InvoiceEvent', 'findMany', {}, undefined)).toThrow(TenantContextError);
    expect(applyTenantArgs('User', 'findFirst', { where: { email: 'a@b' } }, null, true)).toEqual({ where: { email: 'a@b' } });
  });
});
