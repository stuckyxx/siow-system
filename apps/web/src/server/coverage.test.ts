import { describe, expect, it } from 'vitest';
process.env.DATABASE_URL ??= 'postgresql://x:y@localhost/z';
const { effectiveStatus, findIbgeCode, normalizeName, isCoverageCode } = await import('./services/coverage.js');
const { MUNICIPALITIES, CAPITALS } = await import('./geo/municipios-ma-pi-to.js');

describe('mapa de cobertura — base de municípios', () => {
  it('tem todos os municípios atuais de MA (217), PI (224) e TO (139)', () => {
    const count = (uf: string) => MUNICIPALITIES.filter((m) => m[1] === uf).length;
    expect(count('MA')).toBe(217); expect(count('PI')).toBe(224); expect(count('TO')).toBe(139);
    expect(isCoverageCode('2206720')).toBe(true); // Nazária (PI), ausente na fonte original
  });
  it('capitais corretas', () => { expect(CAPITALS).toEqual({ '2111300': 'São Luís', '2211001': 'Teresina', '1721000': 'Palmas' }); });
});

describe('mapa de cobertura — casamento por nome (código IBGE)', () => {
  it('normaliza acento, caixa e pontuação', () => { expect(normalizeName('  PINDARÉ-Mirim ')).toBe('pindare mirim'); });
  it('casa grafias comuns', () => {
    expect(findIbgeCode('MA', 'Icatú')).toBe('2105104');
    expect(findIbgeCode('ma', 'Pindaré Mirim')).toBe('2108504');
    expect(findIbgeCode('MA', 'São Luis Gonzaga do Maranhão')).toBe('2111409');
    expect(findIbgeCode('PI', 'PORTO ALEGRE DO PIAUÍ')).toBe('2208551');
    expect(findIbgeCode('MA', 'São Luís')).toBe('2111300');
  });
  it('aplica as correspondências aprovadas', () => {
    expect(findIbgeCode('MA', 'Campestre')).toBe('2102556');
    expect(findIbgeCode('MA', 'Edson Lobão')).toBe('2104552');
    expect(findIbgeCode('MA', 'Santa Filomena')).toBe('2109759');
    expect(findIbgeCode('PI', 'Santa Filomena')).toBe('2209203'); // a do Piauí continua a do Piauí
    expect(findIbgeCode('MA', 'Santa Quitéria')).toBe('2110104');
    expect(findIbgeCode('MA', 'São Mateus')).toBe('2111508');
    expect(findIbgeCode('PI', 'Cocal do Alves ')).toBe('2202729');
  });
  it('não casa fora da cobertura nem nomes inexistentes', () => {
    expect(findIbgeCode('SP', 'Campinas')).toBeNull();
    expect(findIbgeCode('MA', 'Cidade Inventada')).toBeNull();
  });
});

describe('mapa de cobertura — situação efetiva', () => {
  it('contrato ativo → cliente ativo', () => { expect(effectiveStatus(true, null)).toBe('ATIVO'); expect(effectiveStatus(true, 'NENHUMA')).toBe('ATIVO'); });
  it('implantação manual vence o ativo automático', () => { expect(effectiveStatus(true, 'IMPLANTACAO')).toBe('IMPLANTACAO'); expect(effectiveStatus(false, 'IMPLANTACAO')).toBe('IMPLANTACAO'); });
  it('negociação não rebaixa um cliente ativo', () => { expect(effectiveStatus(true, 'NEGOCIACAO')).toBe('ATIVO'); expect(effectiveStatus(false, 'NEGOCIACAO')).toBe('NEGOCIACAO'); });
  it('sem nada → sem atuação', () => { expect(effectiveStatus(false, null)).toBe('NENHUMA'); });
  it('oportunidade em aberto → em negociação automática, sem rebaixar cliente ativo nem implantação', () => {
    expect(effectiveStatus(false, null, true)).toBe('NEGOCIACAO'); expect(effectiveStatus(false, 'NENHUMA', true)).toBe('NEGOCIACAO');
    expect(effectiveStatus(true, null, true)).toBe('ATIVO'); expect(effectiveStatus(false, 'IMPLANTACAO', true)).toBe('IMPLANTACAO');
  });
});
