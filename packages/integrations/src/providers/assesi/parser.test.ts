import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseContractHeader, parseIndexPage, parseInvoiceList } from './parser.js';
import { AssesiPortalProvider } from './provider.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => readFileSync(join(here, '__fixtures__', name), 'utf8');
const BASE = 'https://assesi.com.br/adm_faturas/index.php?e=545110&t=1';

describe('parseContractHeader', () => {
  it('extrai número, aditivo e vigência', () => {
    const c = parseContractHeader('CONTRATO: 070201001/2025 1º Ad - 07/02/2025 à 31/12/2026', '20153373');
    expect(c.number).toBe('070201001/2025');
    expect(c.amendmentLabel).toBe('1º Ad');
    expect(c.amendmentSequence).toBe(1);
    expect(c.startDate).toBe('2025-02-07');
    expect(c.endDate).toBe('2026-12-31');
    expect(c.externalCode).toBe('20153373');
  });
  it('lida com ADT e com contrato sem aditivo', () => {
    expect(parseContractHeader('CONTRATO: 00120230821 6º ADT - 21/08/2023 à 20/08/2027', null)).toMatchObject({
      number: '00120230821',
      amendmentSequence: 6,
      startDate: '2023-08-21',
      endDate: '2027-08-20',
    });
    expect(parseContractHeader('CONTRATO: 123/2024 - 01/01/2024 à 31/12/2024', null)).toMatchObject({
      number: '123/2024',
      amendmentLabel: null,
      amendmentSequence: null,
    });
  });
  it('lida com os formatos reais das 40 entidades (Adtv, 1ºADT, " - 1º ADT -", prefixo 4AD, S/N)', () => {
    const cases: Array<[string, string | null, number | null]> = [
      ['CONTRATO: 003/2025 1º Adtv - 17/03/2025 à 16/03/2027', '003/2025', 1],
      ['CONTRATO: 01/DP/012/2025 1ºAdt - 02/01/2025 à 30/11/2026', '01/DP/012/2025', 1],
      ['CONTRATO: 20250008 - 1º ADT - 07/02/2025 à 31/12/2026', '20250008', 1],
      ['CONTRATO: 004/2025 - 1ºADT - 24/01/2025 à 23/01/2027', '004/2025', 1],
      ['CONTRATO: 005/2023 - 1º Adtv. - 02/01/2024 à 31/12/2024', '005/2023', 1],
      ['CONTRATO: 2023130301/2023 1ºad - 13/03/2023 à 17/10/2024', '2023130301/2023', 1],
      ['CONTRATO: 4AD 2022000504 - 02/01/2026 à 11/12/2026', '2022000504', 4],
      ['CONTRATO: 020201002/2021 4ºADT - 02/01/2025 à 29/01/2026', '020201002/2021', 4],
      ['CONTRATO: S/N - 05/01/2024 à 31/12/2024', 'S/N', null],
      ['CONTRATO: 00103262025 – CMSQMA - 26/03/2025 à 25/03/2027', '00103262025 – CMSQMA', null],
      ['CONTRATO: 009 / 2024 - 02/01/2025 à 31/12/2025', '009 / 2024', null],
    ];
    for (const [header, number, seq] of cases) {
      const c = parseContractHeader(header, null);
      expect(c.number, header).toBe(number);
      expect(c.amendmentSequence, header).toBe(seq);
    }
  });
});

describe('parseIndexPage', () => {
  const page = parseIndexPage(fixture('index_cm_araioses.html'), BASE);

  it('identifica a entidade', () => {
    expect(page.entity).toMatchObject({
      shortName: 'CM ARAIOSES',
      name: 'CÂMARA MUNICIPAL DE ARAIOSES',
      uf: 'MA',
      externalCode: '10523',
      externalType: '1',
    });
  });

  it('lê os cards de resumo', () => {
    expect(page.summary.totalDebt).toBe(750);
    expect(page.summary.pendingCount).toBe(1);
    expect(page.summary.lastPaymentAt).toBe('2026-08-20');
  });

  it('extrai contrato e notas pendentes com documentos', () => {
    expect(page.contracts).toHaveLength(1);
    expect(page.contracts[0]).toMatchObject({ number: '00120230821', externalCode: '20152923' });
    expect(page.invoices).toHaveLength(1);
    const inv = page.invoices[0]!;
    expect(inv).toMatchObject({
      number: '50614',
      externalId: '64769',
      contractExternalCode: '20152923',
      competenceMonth: 9,
      competenceYear: 2026,
      amount: 750,
      issueDate: '2026-09-22',
      status: 'PENDING',
      paidAt: null,
    });
    const nf = inv.documents.find((d) => d.kind === 'INVOICE');
    expect(nf?.method).toBe('POST');
    expect(nf?.sideEffects).toBe(true);
    expect(nf?.url).toContain('https://assesi.com.br/adm_faturas/ver_nota.php?NNota=64769');
  });

  it('captura a descrição (Histórico) do modal', () => {
    expect(page.descriptions['50614']).toMatch(/SERVIÇOS PRESTADOS EM CRIAÇÃO/);
  });

  it('extrai certidões com validade', () => {
    expect(page.certificates).toHaveLength(4);
    expect(page.certificates[0]).toMatchObject({
      name: 'Certidão de falência e concordata',
      externalId: '1462',
      validUntil: '2026-10-28',
      url: 'https://assesi.com.br/storage/certidoes/1462.pdf',
    });
    expect(page.certificatesUpdatedAt).toBe('2026-09-29');
  });
});

describe('parseInvoiceList (AJAX "Todas")', () => {
  const list = parseInvoiceList(fixture('ajax_all_cm_bom_lugar.html'), 'https://www.assesi.com.br/adm_faturas/index.php?e=504673&t=1');

  it('normaliza pendentes e pagas com data de pagamento', () => {
    expect(list.invoices).toHaveLength(4);
    const byNumber = Object.fromEntries(list.invoices.map((i) => [i.number, i]));
    expect(byNumber['50616']).toMatchObject({ status: 'PENDING', competenceMonth: 9, competenceYear: 2026, amount: 1320 });
    expect(byNumber['43745']).toMatchObject({ status: 'PAID', paidAt: '2025-07-18', competenceMonth: 3, competenceYear: 2025 });
    expect(byNumber['41905']).toMatchObject({ status: 'PAID', paidAt: '2025-03-17', issueDate: '2025-03-13' });
    const receipt = byNumber['43745']!.documents.find((d) => d.kind === 'RECEIPT');
    expect(receipt?.url).toBe('https://www.assesi.com.br/adm_faturas/recibo.php?id=57881&data=2025-07-18');
  });

  it('associa todas as notas ao contrato do cabeçalho', () => {
    expect(list.contracts[0]).toMatchObject({ number: '070201001/2025', amendmentSequence: 1, externalCode: '20153373' });
    expect(list.invoices.every((i) => i.contractExternalCode === '20153373')).toBe(true);
  });
});

describe('AssesiPortalProvider.fetchSnapshot', () => {
  it('combina página inicial + listagem completa via fetch injetado', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      const body = url.includes('Faturas.ajax.php') ? fixture('ajax_all_cm_bom_lugar.html') : fixture('index_cm_araioses.html');
      return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=UTF-8' } });
    };
    const snap = await new AssesiPortalProvider().fetchSnapshot({ url: BASE }, { timeoutMs: 5000, userAgent: 'test', fetchImpl });
    expect(calls[0]).toBe(`GET ${BASE}`);
    expect(calls[1]).toBe('POST https://assesi.com.br/adm_faturas/ajax/Faturas.ajax.php');
    expect(snap.invoiceListComplete).toBe(true);
    // 4 da listagem completa + 1 pendente da página inicial que não constava nela (sanidade)
    expect(snap.invoices).toHaveLength(5);
    expect(snap.invoices.find((i) => i.number === '50614')?.description).toMatch(/SERVIÇOS PRESTADOS/);
    expect(snap.certificates).toHaveLength(4);
    expect(snap.warnings.some((w) => w.includes('50614'))).toBe(true);
  });

  it('falha de forma explícita quando o conteúdo não é o portal', async () => {
    const fetchImpl: typeof fetch = async () => new Response('<html><body>Login</body></html>', { status: 200 });
    await expect(
      new AssesiPortalProvider().fetchSnapshot({ url: BASE }, { timeoutMs: 5000, userAgent: 'test', fetchImpl }),
    ).rejects.toThrow(/Conteúdo inesperado/);
  });
});
