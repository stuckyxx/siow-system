/**
 * Parser do Portal do Cliente (adm_faturas). Puro: recebe HTML, devolve
 * estruturas normalizadas. Nenhuma regra de negócio aqui — apenas extração.
 *
 * Estrutura observada (set/2026):
 *  - cabeçalho:      .entity-name / .entity-state, inputs #tipoEntidade #codEntidade
 *  - cards:          .info-card > .info-card-label + .info-card-value
 *  - contratos:      .contract-header > span (entidade) + p ("CONTRATO: <nº> <aditivo> - <ini> à <fim>")
 *  - notas:          .invoice-card (.paid quando quitada) > .invoice-title, .invoice-meta .value×3, .invoice-badge
 *  - detalhe:        #ModalFaturas<nº> (só nas pendentes da página inicial) com "Histórico"
 *  - certidões:      .certificate-item[href] > .certificate-text, "Válida até dd/mm/aaaa"
 *  - listagem total: POST ajax/Faturas.ajax.php (mesma estrutura de .contract-header/.invoice-card)
 */
import * as cheerio from 'cheerio';
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import { parseBRL, parseBrDate, parseCompetence } from '@siow/shared';
import type {
  CertificateSnapshot,
  ContractSnapshot,
  DocumentRef,
  EntitySnapshot,
  InvoiceSnapshot,
  NormalizedInvoiceStatus,
  SummarySnapshot,
} from '../../types.js';

export interface ParsedIndexPage {
  entity: EntitySnapshot;
  summary: SummarySnapshot;
  contracts: ContractSnapshot[];
  invoices: InvoiceSnapshot[];
  /** descrições (Histórico) por número de nota, vindas dos modais */
  descriptions: Record<string, string>;
  certificates: CertificateSnapshot[];
  certificatesUpdatedAt: string | null;
  warnings: string[];
}

export interface ParsedInvoiceList {
  contracts: ContractSnapshot[];
  invoices: InvoiceSnapshot[];
  warnings: string[];
}

const clean = (s: string | undefined | null): string => (s ?? '').replace(/\s+/g, ' ').trim();

function absolute(base: string, href: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

// ----------------------------------------------------------------------------
// Contrato
// ----------------------------------------------------------------------------

// Formatos reais observados no portal (set/2026):
//   "00120230821 6º ADT", "070201001/2025 1º Ad", "003/2025 1º Adtv", "01/DP/012/2025 1ºAdt",
//   "20250008 - 1º ADT", "004/2025 - 1ºADT", "005/2023 - 1º Adtv.", "2023130301/2023 1ºad",
//   "4AD 2022000504" (aditivo como prefixo), "S/N" (sem número)
const AMENDMENT_RE = /(\d+)\s*[ºo°]?\s*(?:ADTV|ADT|ADIT|ADITIVO|AD|TA)\b\.?/i;
const AMENDMENT_PREFIX_RE = /^(\d+)\s*[ºo°]?\s*(?:ADTV|ADT|ADIT|ADITIVO|AD|TA)\s+(.+)$/i;

/**
 * "CONTRATO: 070201001/2025 1º Ad - 07/02/2025 à 31/12/2026"
 * "CONTRATO: 00120230821 6º ADT - 21/08/2023 à 20/08/2027"
 * "CONTRATO: 20250008 - 1º ADT - 07/02/2025 à 31/12/2026"
 * "CONTRATO: 4AD 2022000504 - 02/01/2026 à 11/12/2026"
 * "CONTRATO: S/N - 05/01/2024 à 31/12/2024"
 */
export function parseContractHeader(text: string, externalCode: string | null): ContractSnapshot {
  const raw = clean(text);
  const body = raw.replace(/^CONTRATO:\s*/i, '');
  const dates = [...body.matchAll(/(\d{2}\/\d{2}\/\d{4})/g)].map((m) => m[1]!);
  const startDate = dates[0] ? parseBrDate(dates[0]) : null;
  const endDate = dates[1] ? parseBrDate(dates[1]) : null;
  // tudo antes do primeiro " - dd/mm/aaaa" é número + aditivo
  let head = body;
  const idx = dates[0] ? body.indexOf(dates[0]) : -1;
  if (idx >= 0) head = body.slice(0, idx).replace(/[-–—]\s*$/, '').trim();

  let amendmentLabel: string | null = null;
  let amendmentSequence: number | null = null;
  let number: string | null = head || null;
  const prefix = AMENDMENT_PREFIX_RE.exec(head);
  const m = prefix ? null : AMENDMENT_RE.exec(head);
  if (prefix) {
    amendmentSequence = Number(prefix[1]);
    amendmentLabel = `${amendmentSequence}º ADT`;
    number = clean(prefix[2]!) || null;
  } else if (m) {
    amendmentLabel = clean(m[0]);
    amendmentSequence = Number(m[1]);
    number = clean(head.slice(0, m.index) + ' ' + head.slice(m.index + m[0].length)) || null;
  }
  // remove separadores soltos ("20250008 -" → "20250008"); "S/N" fica como está (sem número)
  if (number) number = number.replace(/^[-–—\s]+|[-–—\s]+$/g, '').trim() || null;
  return { externalCode, number, amendmentLabel, amendmentSequence, startDate, endDate, rawHeader: raw };
}

function contractExternalCodeFromHeader($: CheerioAPI, header: Cheerio<AnyNode>): string | null {
  const id = header.find('button[id^="dropdownMenuButtonContrato"]').attr('id') ?? '';
  const m = /Contrato(\d+)/.exec(id);
  if (m) return m[1]!;
  const target = header.find('a[data-target^="#ModalAditivo"]').attr('data-target') ?? '';
  const m2 = /ModalAditivo(\d+)/.exec(target);
  return m2 ? m2[1]! : null;
}

// ----------------------------------------------------------------------------
// Notas
// ----------------------------------------------------------------------------

function normalizeStatus(badge: Cheerio<AnyNode>, card: Cheerio<AnyNode>): { status: NormalizedInvoiceStatus; raw: string; paidAt: string | null } {
  const raw = clean(badge.text());
  const cls = `${badge.attr('class') ?? ''} ${card.attr('class') ?? ''}`.toLowerCase();
  if (/\bpaid\b|quitad|\bpag[ao]\b/.test(cls) || /quitad|\bpaga\b/i.test(raw)) {
    return { status: 'PAID', raw, paidAt: parseBrDate(raw) };
  }
  if (/\bpending\b|pendent/.test(cls) || /pendent/i.test(raw)) {
    return { status: 'PENDING', raw, paidAt: null };
  }
  if (/cancel/.test(cls) || /cancel/i.test(raw)) {
    return { status: 'CANCELLED', raw, paidAt: null };
  }
  // "Vencida" / "Em atraso": ainda é uma nota em aberto → PENDING
  if (/vencid|atras/i.test(raw) || /vencid|atras|overdue/.test(cls)) {
    return { status: 'PENDING', raw, paidAt: null };
  }
  return { status: 'UNKNOWN', raw, paidAt: null };
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

function parseInvoiceCard(
  $: CheerioAPI,
  card: Cheerio<AnyNode>,
  contract: ContractSnapshot | null,
  baseUrl: string,
  warnings: string[],
): InvoiceSnapshot | null {
  const title = clean(card.find('.invoice-title').first().text());
  const numberMatch = /(\d+)/.exec(title);
  if (!numberMatch) {
    warnings.push(`Card de nota sem número: "${title}"`);
    return null;
  }
  const number = numberMatch[1]!;
  const metaValues = card
    .find('.invoice-meta .value')
    .map((_i, el) => clean($(el).text()))
    .get();

  // Ordem observada: competência, valor, emissão — mas identificamos pelo conteúdo para robustez
  let competenceText: string | null = null;
  let amountText: string | null = null;
  let issueText: string | null = null;
  for (const v of metaValues) {
    if (!competenceText && /^[A-ZÇ]{3}\s*\/\s*\d{4}$|^\d{1,2}\s*\/\s*\d{4}$/i.test(v)) competenceText = v;
    else if (!amountText && /R\$|,\d{2}$/.test(v)) amountText = v;
    else if (!issueText && /^\d{2}\/\d{2}\/\d{4}(\s+\d{1,2}:\d{2}(:\d{2})?)?$/.test(v)) issueText = v;
  }

  const form = card.find('form[action*="ver_nota"]').first();
  const action = form.attr('action') ?? '';
  const query = parseQuery(action);
  const externalId = query['NNota'] ?? form.find('input[name="idNota"]').attr('value') ?? null;
  const contractExternalCode = query['NContrato'] ?? contract?.externalCode ?? null;

  let competence = parseCompetence(competenceText);
  if (!competence && query['Competencia'] && query['Exercicio']) {
    competence = { month: Number(query['Competencia']), year: Number(query['Exercicio']) };
  }
  if (!competence) {
    warnings.push(`Nota ${number}: competência não identificada ("${competenceText ?? ''}")`);
    return null;
  }
  const amount = parseBRL(amountText);
  if (amount === null) {
    warnings.push(`Nota ${number}: valor não identificado ("${amountText ?? ''}")`);
    return null;
  }

  const badge = card.find('.invoice-badge').first();
  const { status, raw, paidAt } = normalizeStatus(badge, card);

  const documents: DocumentRef[] = [];
  if (action) {
    documents.push({
      kind: 'INVOICE',
      url: absolute(baseUrl, action),
      method: 'POST',
      form: externalId ? { idNota: externalId } : {},
      sideEffects: true, // o portal incrementa "QtdeVisualizada" a cada acesso
    });
  }
  const receipt = card.find('a[href*="recibo.php"]').first().attr('href');
  if (receipt) documents.push({ kind: 'RECEIPT', url: absolute(baseUrl, receipt), method: 'GET' });
  card.find('form[action*="prestacao.php"]').each((_i, el) => {
    documents.push({ kind: 'SERVICE_REPORT', url: absolute(baseUrl, $(el).attr('action') ?? ''), method: 'POST', form: { idNota: externalId ?? '' }, sideEffects: true });
  });

  return {
    number,
    externalId,
    contractExternalCode,
    competenceMonth: competence.month,
    competenceYear: competence.year,
    amount,
    issueDate: parseBrDate(issueText),
    status,
    statusRaw: raw,
    paidAt,
    description: null,
    documents,
    raw: { title, metaValues, badge: raw, action, cardClass: card.attr('class') ?? '' },
  };
}

/**
 * Percorre a listagem (página inicial ou fragmento AJAX) na ordem do DOM,
 * associando cada nota ao último .contract-header encontrado.
 */
export function parseInvoiceList(html: string, baseUrl: string): ParsedInvoiceList {
  const $ = cheerio.load(html);
  const warnings: string[] = [];
  const contracts: ContractSnapshot[] = [];
  const invoices: InvoiceSnapshot[] = [];
  let current: ContractSnapshot | null = null;

  $('.contract-header, .invoice-card').each((_i, el) => {
    const node = $(el);
    if (node.hasClass('contract-header')) {
      const code = contractExternalCodeFromHeader($, node);
      const text = clean(node.find('p').first().text()) || clean(node.text());
      current = parseContractHeader(text, code);
      if (!contracts.some((c) => c.externalCode === current!.externalCode && c.rawHeader === current!.rawHeader)) {
        contracts.push(current);
      }
      return;
    }
    const inv = parseInvoiceCard($, node, current, baseUrl, warnings);
    if (inv) invoices.push(inv);
  });

  return { contracts, invoices, warnings };
}

// ----------------------------------------------------------------------------
// Página inicial
// ----------------------------------------------------------------------------

function parseCards($: CheerioAPI): SummarySnapshot {
  const summary: SummarySnapshot = {
    totalDebt: null,
    pendingCount: null,
    paidCount: null,
    totalPaid: null,
    lastPaymentAt: null,
    statusText: null,
  };
  $('.info-card').each((_i, el) => {
    const label = clean($(el).find('.info-card-label').text()).toLowerCase();
    const value = clean($(el).find('.info-card-value').text());
    if (label.includes('débito') || label.includes('debito')) summary.totalDebt = parseBRL(value);
    else if (label.includes('pendente')) summary.pendingCount = Number(/(\d+)/.exec(value)?.[1] ?? NaN) || 0;
    else if (label.includes('pagas') || label.includes('quitadas')) summary.paidCount = Number(/(\d+)/.exec(value)?.[1] ?? NaN) || 0;
    else if (label.includes('total pago') || label.includes('recebido')) summary.totalPaid = parseBRL(value);
    else if (label.includes('último pagamento') || label.includes('ultimo pagamento')) {
      summary.lastPaymentAt = parseBrDate(value);
    } else if (label.includes('situa') || label.includes('status')) summary.statusText = value;
  });
  return summary;
}

function parseDescriptions($: CheerioAPI): Record<string, string> {
  const out: Record<string, string> = {};
  $('[id^="ModalFaturas"]').each((_i, el) => {
    const id = $(el).attr('id') ?? '';
    const m = /^ModalFaturas(\d+)$/.exec(id);
    if (!m) return;
    const body = $(el).find('.modal-body');
    // O bloco "Histórico:" é um <strong> seguido de uma div com o texto
    let text = '';
    body.find('strong').each((_j, s) => {
      if (/hist[óo]rico/i.test($(s).text())) {
        text = clean($(s).next().text()) || clean($(s).parent().text().replace(/hist[óo]rico:?/i, ''));
      }
    });
    if (text) out[m[1]!] = text;
  });
  return out;
}

function parseCertificates($: CheerioAPI, baseUrl: string): { items: CertificateSnapshot[]; updatedAt: string | null } {
  const items: CertificateSnapshot[] = [];
  $('.certificate-item').each((_i, el) => {
    const node = $(el);
    const href = node.attr('href') ?? node.find('a[href]').attr('href') ?? '';
    const name = clean(node.find('.certificate-text').text());
    if (!name || !href) return;
    const metaText = clean(node.find('.certificate-meta').text());
    const validUntil = /v[áa]lid[ao]\s+at[ée]\s+(\d{2}\/\d{2}\/\d{4})/i.exec(metaText)?.[1] ?? null;
    const issued = /emitid[ao]\s+em\s+(\d{2}\/\d{2}\/\d{4})/i.exec(metaText)?.[1] ?? null;
    const externalId = /\/(\d+)\.pdf/i.exec(href)?.[1] ?? null;
    items.push({
      name,
      externalId,
      url: absolute(baseUrl, href),
      validUntil: parseBrDate(validUntil),
      issuedAt: parseBrDate(issued),
    });
  });
  const updatedText = clean($('.certificates-date').text());
  const updatedAt = parseBrDate(/(\d{2}\/\d{2}\/\d{4})/.exec(updatedText)?.[1] ?? null);
  return { items, updatedAt };
}

export function parseIndexPage(html: string, sourceUrl: string): ParsedIndexPage {
  const $ = cheerio.load(html);
  const warnings: string[] = [];

  const shortName = clean($('.entity-name').first().text()) || null;
  const uf = clean($('.entity-state').first().text()).toUpperCase() || null;
  const externalCode = $('#codEntidade').attr('value') ?? null;
  const externalType = $('#tipoEntidade').attr('value') ?? null;
  const logo = $('.header-client-logo img').attr('src') ?? null;

  const list = parseInvoiceList(html, sourceUrl);
  warnings.push(...list.warnings);

  // Nome completo vem do primeiro cabeçalho de contrato ("CÂMARA MUNICIPAL DE ...")
  const fullName = clean($('.contract-header span').first().text()) || null;

  if (!shortName && !fullName) warnings.push('Nome da entidade não encontrado na página');
  if (!externalCode) warnings.push('codEntidade não encontrado — listagem completa via AJAX indisponível');

  const certs = parseCertificates($, sourceUrl);
  const sqlErrors = (html.match(/SQLSTATE\[/g) ?? []).length;
  if (sqlErrors > 0) warnings.push(`Portal exibiu ${sqlErrors} erro(s) de banco (SQLSTATE) na página — dados podem estar incompletos`);

  return {
    entity: {
      name: fullName,
      shortName,
      uf,
      externalCode,
      externalType,
      logoUrl: logo ? absolute(sourceUrl, logo) : null,
    },
    summary: parseCards($),
    contracts: list.contracts,
    invoices: list.invoices,
    descriptions: parseDescriptions($),
    certificates: certs.items,
    certificatesUpdatedAt: certs.updatedAt,
    warnings,
  };
}
