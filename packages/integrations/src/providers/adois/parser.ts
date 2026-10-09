/**
 * Parser do Portal do Cliente da Adois (adoissolucoes.com/adm_faturas). Puro: HTML → estruturas normalizadas.
 *
 * Dois tipos de link, com o MESMO HTML de listagem:
 *  - t=1 (entidade):  uma prefeitura/câmara; cabeçalho `tr#thead0` "2025 - PREFEITURA MUNICIPAL DE TUNTUM",
 *                     meta description "PM TUNTUM - MA", h3.card-header com o nome, Estatística (Total pendente/pago).
 *  - t=2 (parceiro):  notas de uma EMPRESA parceira para várias entidades. A entidade de cada nota (município)
 *                     está só na descrição do modal: "… para Prefeitura de Bom Jardim - MA" / "… para Câmara de Icatu - MA".
 *                     O agrupamento confiável é o código do contrato (NContrato no formulário ver_nota.php).
 *
 * Estrutura observada (out/2026):
 *  - inputs ocultos #tipoEntidade (1 entidade, 2 parceiro) e #codEntidade
 *  - linhas:   tr.linha > td[data-title=Número|Mês|Exercício|Valor|Emissão|Pagamento]
 *              Pagamento = "Pendente" ou a DATA do pagamento (dd/mm/aaaa) = paga
 *  - detalhe:  #ModalFaturas<nº> .modal-body > div[style*=justify] (descrição; "conforme contrato nº 184/2025")
 *  - nota:     form[action^=ver_nota.php?NNota=&NContrato=&NEntidade=&NumNota=&Entidade=&Competencia=&Exercicio=]
 *  - listagem completa: POST ajax/Faturas.ajax.php (callback=Faturas&callback_action=filtro_tipo&p_tipo=0)
 */
import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import { parseBRL, parseBrDate, parseCompetence } from '@siow/shared';
import type { ContractSnapshot, DocumentRef, EntitySnapshot, InvoiceSnapshot, NormalizedInvoiceStatus, SummarySnapshot } from '../../types.js';

const clean = (s: string | undefined | null): string => (s ?? '').replace(/\s+/g, ' ').trim();
/** Remove acentos e caixa para comparação ("Icatú" ≡ "Icatu"). */
export const normalizeKey = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

function absolute(base: string, href: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

function parseQuery(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  const q = url.split('?')[1] ?? '';
  for (const part of q.split('&')) {
    if (!part) continue;
    const [k, v = ''] = part.split('=');
    try {
      out[decodeURIComponent(k!)] = decodeURIComponent(v.replace(/\+/g, ' '));
    } catch {
      out[k!] = v;
    }
  }
  return out;
}

// ----------------------------------------------------------------------------
// Entidade dentro da descrição (links de parceiro)
// ----------------------------------------------------------------------------

export interface PartnerEntityRef {
  type: 'PM' | 'CM';
  /** grafia como veio da descrição ("Bom Jardim", "Icatú") */
  municipality: string;
  uf: string;
  /** chave estável sem acento/caixa: "CM|ICATU|MA" */
  key: string;
}

// "… para Prefeitura de Bom Jardim - MA", "… para a Câmara Municipal de Cururupu" (sem UF: usa a UF da página)
const PARTNER_ENTITY_RE = /\bpara\s+(?:a\s+|o\s+)?(prefeitura|c[âa]mara)(?:\s+municipal)?(?:\s+de)?\s+(.+?)(?:\s*[-–/]\s*([A-Za-z]{2})\b|\s*[.,;(]|$)/i;

/** "Serviços prestados … para Câmara de Icatu - MA" → { type: CM, municipality: "Icatu", uf: MA }. */
export function partnerEntityFromDescription(description: string | null | undefined, fallbackUf?: string | null): PartnerEntityRef | null {
  if (!description) return null;
  const m = PARTNER_ENTITY_RE.exec(clean(description));
  if (!m) return null;
  const type = /^pref/i.test(m[1]!) ? 'PM' : 'CM';
  const municipality = clean(m[2]!).replace(/^(município|municipio)\s+de\s+/i, '').replace(/\s+(conforme|referente|ref\.?|relativ[ao]).*$/i, '');
  const uf = (m[3] ?? fallbackUf ?? '').toUpperCase();
  if (!municipality || !/^[A-Z]{2}$/.test(uf)) return null;
  return { type, municipality, uf, key: `${type}|${normalizeKey(municipality)}|${uf}` };
}

export const partnerEntityName = (e: Pick<PartnerEntityRef, 'type' | 'municipality'>): { name: string; shortName: string } => ({
  name: `${e.type === 'PM' ? 'PREFEITURA MUNICIPAL DE' : 'CÂMARA MUNICIPAL DE'} ${e.municipality.toUpperCase()}`,
  shortName: `${e.type} ${e.municipality.toUpperCase()}`,
});

// ----------------------------------------------------------------------------
// Linhas da listagem (página inicial ou fragmento AJAX)
// ----------------------------------------------------------------------------

export interface ParsedAdoisList {
  /** nome que aparece no cabeçalho da tabela ("2025 - PREFEITURA MUNICIPAL DE TUNTUM" → sem o ano) */
  headerName: string | null;
  contracts: ContractSnapshot[];
  invoices: InvoiceSnapshot[];
  warnings: string[];
}

function statusFromPayment(text: string): { status: NormalizedInvoiceStatus; paidAt: string | null } {
  const t = clean(text);
  const date = parseBrDate(t);
  if (date) return { status: 'PAID', paidAt: date };
  if (/pendente|vencid|atras|aberto/i.test(t)) return { status: 'PENDING', paidAt: null };
  if (/pag[ao]|quitad/i.test(t)) return { status: 'PAID', paidAt: null };
  if (/cancel/i.test(t)) return { status: 'CANCELLED', paidAt: null };
  return { status: 'UNKNOWN', paidAt: null };
}

function parseDescriptions($: CheerioAPI): Record<string, string> {
  const out: Record<string, string> = {};
  $('[id^="ModalFaturas"]').each((_i, el) => {
    const m = /^ModalFaturas(\d+)$/.exec($(el).attr('id') ?? '');
    if (!m) return;
    const text = clean($(el).find('.modal-body div[style*="justify"]').first().text());
    if (text) out[m[1]!] = text;
  });
  return out;
}

const CONTRACT_NUMBER_RE = /contrato\s*(?:n|nº|n°|no|número|numero)?[.ºo°:]*\s*([0-9][0-9A-Za-z./-]*)/i;

export function parseAdoisList(html: string, baseUrl: string): ParsedAdoisList {
  const $ = cheerio.load(html);
  const warnings: string[] = [];
  const descriptions = parseDescriptions($);
  const invoices: InvoiceSnapshot[] = [];
  const contractsByCode = new Map<string, ContractSnapshot>();

  const headerRaw = clean($('tr#thead0 td[data-title="Contrato"]').first().text());
  const headerName = headerRaw ? headerRaw.replace(/^\d{4}\s*[-–]\s*/, '') || null : null;

  $('tr.linha').each((_i, el) => {
    const row = $(el);
    const cell = (title: string): string => clean(row.find(`td[data-title="${title}"]`).first().text());
    const number = /(\d+)/.exec(cell('Número'))?.[1] ?? null;
    if (!number) {
      warnings.push(`Linha de nota sem número: "${clean(row.text()).slice(0, 60)}"`);
      return;
    }
    const form = row.find('form[action*="ver_nota"]').first();
    const action = form.attr('action') ?? '';
    const query = parseQuery(action);
    const externalId = query['NNota'] ?? form.find('input[name="idNota"]').attr('value') ?? null;
    const contractExternalCode = query['NContrato'] ?? null;

    let competence = parseCompetence(`${cell('Mês')}/${cell('Exercício')}`);
    if (!competence && query['Competencia'] && query['Exercicio']) competence = { month: Number(query['Competencia']), year: Number(query['Exercicio']) };
    if (!competence) {
      warnings.push(`Nota ${number}: competência não identificada ("${cell('Mês')}/${cell('Exercício')}")`);
      return;
    }
    // "2.500, 00" (com espaço após a vírgula) → parseBRL ignora o espaço
    const amount = parseBRL(cell('Valor'));
    if (amount === null) {
      warnings.push(`Nota ${number}: valor não identificado ("${cell('Valor')}")`);
      return;
    }
    const paymentText = cell('Pagamento');
    const { status, paidAt } = statusFromPayment(paymentText);
    if (status === 'UNKNOWN') warnings.push(`Nota ${number}: situação não reconhecida ("${paymentText}")`);

    const description = descriptions[number] ?? null;
    const documents: DocumentRef[] = [];
    if (action) documents.push({ kind: 'INVOICE', url: absolute(baseUrl, action), method: 'POST', form: externalId ? { idNota: externalId } : {}, sideEffects: true });
    row.find('form[action*="prestacao.php"]').each((_j, f) => {
      documents.push({ kind: 'SERVICE_REPORT', url: absolute(baseUrl, $(f).attr('action') ?? ''), method: 'POST', form: { idNota: externalId ?? '', data: '' }, sideEffects: true });
    });

    const partner = partnerEntityFromDescription(description);
    invoices.push({
      number,
      externalId,
      contractExternalCode,
      competenceMonth: competence.month,
      competenceYear: competence.year,
      amount,
      issueDate: parseBrDate(cell('Emissão')),
      status,
      statusRaw: paymentText,
      paidAt,
      description,
      documents,
      raw: { payment: paymentText, action, entity: query['Entidade'] ?? null, partnerEntity: partner?.key ?? null },
    });

    if (contractExternalCode && !contractsByCode.has(contractExternalCode)) {
      const number = CONTRACT_NUMBER_RE.exec(description ?? '')?.[1]?.replace(/[.,;]+$/, '') ?? contractExternalCode;
      contractsByCode.set(contractExternalCode, {
        externalCode: contractExternalCode,
        number,
        amendmentLabel: null,
        amendmentSequence: null,
        startDate: null,
        endDate: null,
        rawHeader: headerRaw || description || `Contrato ${contractExternalCode}`,
      });
    }
  });

  return { headerName, contracts: [...contractsByCode.values()], invoices, warnings };
}

// ----------------------------------------------------------------------------
// Página inicial (entidade, resumo)
// ----------------------------------------------------------------------------

export interface ParsedAdoisIndex extends ParsedAdoisList {
  entity: EntitySnapshot;
  /** nome da empresa/entidade no cartão da direita (h3.card-header) */
  cardName: string | null;
  summary: SummarySnapshot;
}

export function parseAdoisIndex(html: string, sourceUrl: string): ParsedAdoisIndex {
  const $ = cheerio.load(html);
  const list = parseAdoisList(html, sourceUrl);
  const warnings = [...list.warnings];

  const externalCode = $('#codEntidade').attr('value') ?? null;
  const externalType = $('#tipoEntidade').attr('value') ?? null;
  const cardName = clean($('h3.card-header').first().text()) || null;
  // meta description: "PM TUNTUM - MA" (entidade) / "SOFTNOW - MA" (parceiro)
  const meta = clean($('meta[name="description"]').attr('content'));
  const metaMatch = /^(.*?)\s*[-–]\s*([A-Za-z]{2})$/.exec(meta);
  const shortName = metaMatch ? clean(metaMatch[1]) || null : meta || null;
  const uf = metaMatch ? metaMatch[2]!.toUpperCase() : null;
  const logo = $('img.rounded').first().attr('src') ?? null;

  const summary: SummarySnapshot = { totalDebt: null, pendingCount: null, paidCount: null, totalPaid: null, lastPaymentAt: null, statusText: null };
  $('table tr').each((_i, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 2) return;
    const label = clean(tds.first().text()).toLowerCase();
    const value = clean(tds.last().text());
    if (label.startsWith('total pendente')) summary.totalDebt = parseBRL(value);
    else if (label.startsWith('total pago')) summary.totalPaid = parseBRL(value);
  });
  if (!externalCode) warnings.push('codEntidade não encontrado — listagem completa via AJAX indisponível');
  if (!cardName && !list.headerName) warnings.push('Nome da entidade não encontrado na página');
  const sqlErrors = (html.match(/SQLSTATE\[/g) ?? []).length;
  if (sqlErrors > 0) warnings.push(`Portal exibiu ${sqlErrors} erro(s) de banco (SQLSTATE) na página — dados podem estar incompletos`);

  return {
    ...list,
    warnings,
    cardName,
    summary,
    entity: { name: list.headerName ?? cardName, shortName, uf, externalCode, externalType, logoUrl: logo ? absolute(sourceUrl, logo) : null },
  };
}

// ----------------------------------------------------------------------------
// Links de parceiro: agrupa as notas por entidade (município)
// ----------------------------------------------------------------------------

export interface PartnerGroup extends PartnerEntityRef {
  name: string;
  shortName: string;
  contractCodes: string[];
  contracts: ContractSnapshot[];
  invoices: InvoiceSnapshot[];
  pendingCount: number;
  pendingAmount: number;
}

/**
 * Cada contrato (NContrato) pertence a UMA entidade; a entidade é decidida por maioria das descrições
 * das notas do contrato (o portal tem grafias divergentes — "Icatu"/"Icatú", e até "Prefeitura" numa nota
 * de contrato da Câmara). Contratos cuja descrição não identifica a entidade ficam em `unassigned`.
 */
export function groupPartnerInvoices(list: ParsedAdoisList, fallbackUf?: string | null): { groups: PartnerGroup[]; unassigned: InvoiceSnapshot[]; warnings: string[] } {
  const warnings: string[] = [];
  const byContract = new Map<string, InvoiceSnapshot[]>();
  const unassigned: InvoiceSnapshot[] = [];
  for (const inv of list.invoices) {
    const code = inv.contractExternalCode ?? `nota:${inv.number}`;
    byContract.set(code, [...(byContract.get(code) ?? []), inv]);
  }
  const groups = new Map<string, PartnerGroup>();
  for (const [code, invoices] of byContract) {
    const votes = new Map<string, { ref: PartnerEntityRef; n: number; spellings: Map<string, number> }>();
    for (const inv of invoices) {
      const ref = partnerEntityFromDescription(inv.description, fallbackUf);
      if (!ref) continue;
      const v = votes.get(ref.key) ?? { ref, n: 0, spellings: new Map() };
      v.n += 1;
      v.spellings.set(ref.municipality, (v.spellings.get(ref.municipality) ?? 0) + 1);
      votes.set(ref.key, v);
    }
    const winner = [...votes.values()].sort((a, b) => b.n - a.n)[0];
    if (!winner) {
      warnings.push(`Contrato ${code}: nenhuma nota identifica a entidade na descrição`);
      unassigned.push(...invoices);
      continue;
    }
    if (votes.size > 1) warnings.push(`Contrato ${code}: descrições citam entidades diferentes; adotada ${winner.ref.key} (${winner.n}/${invoices.length})`);
    const spelling = [...winner.spellings.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    const ref: PartnerEntityRef = { ...winner.ref, municipality: spelling };
    const names = partnerEntityName(ref);
    const g = groups.get(ref.key) ?? { ...ref, ...names, contractCodes: [], contracts: [], invoices: [], pendingCount: 0, pendingAmount: 0 };
    g.contractCodes.push(code);
    const contract = list.contracts.find((c) => c.externalCode === code);
    if (contract) g.contracts.push(contract);
    g.invoices.push(...invoices);
    for (const inv of invoices) if (inv.status === 'PENDING') { g.pendingCount += 1; g.pendingAmount = Math.round((g.pendingAmount + inv.amount) * 100) / 100; }
    groups.set(ref.key, g);
  }
  return { groups: [...groups.values()].sort((a, b) => a.shortName.localeCompare(b.shortName)), unassigned, warnings };
}
