import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { groupPartnerInvoices, parseAdoisIndex, parseAdoisList, partnerEntityFromDescription } from './parser.js';
import { AdoisPortalProvider } from './provider.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => readFileSync(join(here, '__fixtures__', name), 'utf8');
const ENTITY_URL = 'https://adoissolucoes.com/adm_faturas/index.php?e=514061&t=1';
const PARTNER_URL = 'https://adoissolucoes.com/adm_faturas/index.php?e=521963ts&t=2';

describe('partnerEntityFromDescription', () => {
  it('identifica prefeitura/câmara, município e UF na descrição da nota', () => {
    expect(partnerEntityFromDescription('Serviços prestados de Locação do sistema aSiteGov para Prefeitura de Bom Jardim - MA')).toEqual({ type: 'PM', municipality: 'Bom Jardim', uf: 'MA', key: 'PM|BOM JARDIM|MA' });
    expect(partnerEntityFromDescription('… para Câmara de Icatú - MA')).toMatchObject({ type: 'CM', municipality: 'Icatú', key: 'CM|ICATU|MA' });
    expect(partnerEntityFromDescription('… para Camara Municipal de Icatu - MA')?.key).toBe('CM|ICATU|MA');
    expect(partnerEntityFromDescription('Locação do sistemas Assesi aPlenário para a Câmara Municipal de Cururupu', 'MA')).toEqual({ type: 'CM', municipality: 'Cururupu', uf: 'MA', key: 'CM|CURURUPU|MA' });
    expect(partnerEntityFromDescription('… para a Câmara Municipal de Cururupu, conforme contrato 12/2025', 'MA')?.municipality).toBe('Cururupu');
    expect(partnerEntityFromDescription('… para a Câmara Municipal de Cururupu')).toBeNull(); // sem UF na descrição nem na página
    expect(partnerEntityFromDescription('Locação de software conforme contrato nº 184/2025.')).toBeNull();
    expect(partnerEntityFromDescription(null)).toBeNull();
  });
});

describe('parseAdoisIndex — link de entidade (PM Tuntum)', () => {
  const page = parseAdoisIndex(fixture('index_pm_tuntum.html'), ENTITY_URL);
  it('lê entidade, códigos e resumo', () => {
    expect(page.entity).toMatchObject({ name: 'PREFEITURA MUNICIPAL DE TUNTUM', shortName: 'PM TUNTUM', uf: 'MA', externalCode: '4426', externalType: '1' });
    expect(page.summary.totalDebt).toBe(2500);
    expect(page.summary.totalPaid).toBe(37500);
    expect(page.warnings).toEqual([]);
  });
  it('lê a nota pendente com descrição e número do contrato', () => {
    expect(page.invoices).toHaveLength(1);
    expect(page.invoices[0]).toMatchObject({ number: '926', externalId: '35976', contractExternalCode: '20152003', competenceMonth: 9, competenceYear: 2026, amount: 2500, issueDate: '2026-09-29', status: 'PENDING', paidAt: null });
    expect(page.invoices[0]!.description).toContain('conforme contrato nº 184/2025');
    expect(page.invoices[0]!.documents[0]).toMatchObject({ kind: 'INVOICE', method: 'POST', sideEffects: true, form: { idNota: '35976' } });
    expect(page.contracts).toEqual([expect.objectContaining({ externalCode: '20152003', number: '184/2025' })]);
  });
});

describe('parseAdoisList — listagem completa (AJAX)', () => {
  it('entidade: pendentes + pagas, data do pagamento vira paidAt', () => {
    const list = parseAdoisList(fixture('ajax_all_pm_tuntum.html'), ENTITY_URL);
    expect(list.headerName).toBe('PREFEITURA MUNICIPAL DE TUNTUM');
    expect(list.invoices).toHaveLength(16);
    expect(list.invoices.filter((i) => i.status === 'PAID')).toHaveLength(15);
    expect(list.invoices.find((i) => i.number === '694')).toMatchObject({ status: 'PAID', paidAt: '2026-08-24', statusRaw: '24/08/2026', amount: 2500, competenceMonth: 8 });
    expect(list.warnings).toEqual([]);
  });
  it('parceiro: 71 notas em 3 contratos, agrupadas por entidade (município) da descrição', () => {
    const list = parseAdoisList(fixture('ajax_all_parceiro_amc.html'), PARTNER_URL);
    expect(list.invoices).toHaveLength(71);
    expect(list.contracts.map((c) => c.externalCode)).toEqual(['20151933', '20151934', '20152037']);
    const { groups, unassigned, warnings } = groupPartnerInvoices(list);
    expect(unassigned).toHaveLength(0);
    expect(groups.map((g) => [g.key, g.shortName, g.contractCodes, g.invoices.length, g.pendingCount, g.pendingAmount])).toEqual([
      ['CM|ICATU|MA', 'CM ICATÚ', ['20152037'], 10, 9, 7020],
      ['PM|BOM JARDIM|MA', 'PM BOM JARDIM', ['20151933'], 31, 9, 13050],
      ['PM|ICATU|MA', 'PM ICATÚ', ['20151934'], 30, 9, 14850],
    ]);
    // contrato 20151934 tem descrições divergentes (21 "Prefeitura de Icatú" × 9 "Câmara de Icatu"): vence a maioria
    expect(warnings).toEqual([expect.stringContaining('Contrato 20151934')]);
  });
});

describe('AdoisPortalProvider.fetchSnapshot', () => {
  const stubFetch = (index: string, ajax: string): typeof fetch =>
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.method === 'POST' && url.includes('Faturas.ajax.php') ? ajax : index;
      return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }) as typeof fetch;
  const ctx = (index: string, ajax: string) => ({ timeoutMs: 5000, userAgent: 'test', fetchImpl: stubFetch(index, ajax) });

  it('link de entidade: snapshot completo com resumo do portal', async () => {
    const snap = await new AdoisPortalProvider().fetchSnapshot({ url: ENTITY_URL }, ctx(fixture('index_pm_tuntum.html'), fixture('ajax_all_pm_tuntum.html')));
    expect(snap.provider).toBe('ADOIS_PORTAL');
    expect(snap.invoiceListComplete).toBe(true);
    expect(snap.invoices).toHaveLength(16);
    expect(snap.entity.shortName).toBe('PM TUNTUM');
    expect(snap.summary.totalDebt).toBe(2500);
    expect(snap.certificates).toEqual([]);
  });
  it('link de parceiro: devolve só as notas da entidade indicada em config.entityKey', async () => {
    const snap = await new AdoisPortalProvider().fetchSnapshot({ url: PARTNER_URL, config: { partner: true, entityKey: 'PM|BOM JARDIM|MA' } }, ctx(fixture('index_parceiro_amc.html'), fixture('ajax_all_parceiro_amc.html')));
    expect(snap.entity).toMatchObject({ name: 'PREFEITURA MUNICIPAL DE BOM JARDIM', shortName: 'PM BOM JARDIM', uf: 'MA' });
    expect(snap.invoices).toHaveLength(31);
    expect(snap.invoices.every((i) => i.contractExternalCode === '20151933')).toBe(true);
    expect(snap.summary.totalDebt).toBe(13050);
    expect(snap.contracts).toEqual([expect.objectContaining({ externalCode: '20151933' })]);
  });
  it('link de parceiro sem entityKey é rejeitado', async () => {
    await expect(new AdoisPortalProvider().fetchSnapshot({ url: PARTNER_URL, config: { partner: true } }, ctx(fixture('index_parceiro_amc.html'), fixture('ajax_all_parceiro_amc.html')))).rejects.toThrow(/entityKey/);
  });
  it('parceiro sem UF na descrição usa a UF da página (Alves & Alves → CM Cururupu)', async () => {
    const d = await new AdoisPortalProvider().discoverPartnerEntities('https://adoissolucoes.com/adm_faturas/index.php?e=534040&t=2', ctx(fixture('index_parceiro_alves.html'), fixture('ajax_all_parceiro_alves.html')));
    expect(d.company).toBe('ALVES & ALVES COMERCIO E SERVICOS LTDA');
    expect(d.unassigned).toBe(0);
    expect(d.groups.map((g) => [g.key, g.shortName, g.contractCodes, g.invoices.length])).toEqual([['CM|CURURUPU|MA', 'CM CURURUPU', ['20152024'], 13]]);
  });
  it('descoberta de parceiro lista as entidades', async () => {
    const d = await new AdoisPortalProvider().discoverPartnerEntities(PARTNER_URL, ctx(fixture('index_parceiro_amc.html'), fixture('ajax_all_parceiro_amc.html')));
    expect(d.company).toBe('A M C MOREIRA');
    expect(d.groups.map((g) => g.shortName)).toEqual(['CM ICATÚ', 'PM BOM JARDIM', 'PM ICATÚ']);
  });
});
