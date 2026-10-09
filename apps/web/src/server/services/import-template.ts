/**
 * Planilha de importação de entidades (XLSX). Sem URL: modelo em branco com instruções.
 * Com URL do Portal do Cliente (Assesi, Adois ou parceiro Adois): vem preenchida com a(s) entidade(s)
 * do link e a aba "Notas" com todas as notas lidas do portal (pendentes e pagas), nas mesmas colunas da
 * tela de Notas fiscais — serve para conferir, cadastrar (aba Entidades) e importar (aba Notas).
 */
import ExcelJS from 'exceljs';
import { ENTITY_TYPES, ENTITY_TYPE_LABELS, formatBrDate, isAdoisPartnerUrl, providerForUrl, todayIso } from '@siow/shared';
import { getProvider, type AdoisPortalProvider, type BillingSnapshot, type InvoiceSnapshot } from '@siow/integrations';
import { badRequest } from '../http.js';
import { entityFromPortalNames } from './entities.js';
import { daysOverdue, overdueAfterDays } from './invoices.js';

const ctx = () => ({ timeoutMs: Number(process.env['SYNC_HTTP_TIMEOUT_MS'] ?? 20_000), userAgent: process.env['SYNC_USER_AGENT'] ?? 'SiowSystem/1.0' });

export const ENTITY_COLUMNS = ['tipo', 'entidade', 'municipio', 'uf', 'url', 'nome_completo'] as const;
export const INVOICE_COLUMNS = ['entidade', 'numero', 'competencia', 'exercicio', 'valor', 'emissao', 'situacao', 'pagamento', 'atraso', 'contrato', 'cobranca', 'descricao'] as const;

interface EntityRow { tipo: string; entidade: string; municipio: string; uf: string; url: string; nome_completo: string }
interface InvoiceRowOut { entidade: string; numero: string; competencia: string; exercicio: number; valor: number; emissao: string; situacao: string; pagamento: string; atraso: number | ''; contrato: string; cobranca: string; descricao: string }

const STATUS_PT: Record<string, string> = { PENDING: 'Pendente', PAID: 'Paga', CANCELLED: 'Cancelada', UNKNOWN: 'Desconhecida' };

function invoiceRows(entityShort: string, invoices: InvoiceSnapshot[], contracts: BillingSnapshot['contracts'], overdueAfter: number): InvoiceRowOut[] {
  const today = todayIso();
  const contractNumber = new Map(contracts.map((c) => [c.externalCode ?? '', c.number ?? c.externalCode ?? '']));
  return [...invoices]
    .sort((a, b) => (b.issueDate ?? '').localeCompare(a.issueDate ?? '') || b.competenceYear * 100 + b.competenceMonth - (a.competenceYear * 100 + a.competenceMonth))
    .map((i) => {
      const atraso = daysOverdue({ status: i.status, issueDate: i.issueDate ? new Date(`${i.issueDate}T00:00:00Z`) : null }, today, overdueAfter);
      return {
        entidade: entityShort,
        numero: i.number,
        competencia: `${String(i.competenceMonth).padStart(2, '0')}/${i.competenceYear}`,
        exercicio: i.competenceYear,
        valor: i.amount,
        emissao: i.issueDate ? formatBrDate(i.issueDate) : '',
        situacao: STATUS_PT[i.status] ?? i.status,
        pagamento: i.paidAt ? formatBrDate(i.paidAt) : '',
        atraso: atraso === null || atraso === 0 ? '' : atraso,
        contrato: (i.contractExternalCode ? contractNumber.get(i.contractExternalCode) : '') || i.contractExternalCode || '',
        cobranca: '',
        descricao: i.description ?? '',
      };
    });
}

/** Lê o link e devolve as linhas das duas abas. */
export async function rowsFromLink(url: string): Promise<{ entities: EntityRow[]; invoices: InvoiceRowOut[]; warnings: string[]; title: string }> {
  const providerKey = providerForUrl(url);
  if (!providerKey) throw badRequest('Portal não reconhecido na URL');
  const overdueAfter = await overdueAfterDays();
  if (isAdoisPartnerUrl(url)) {
    const d = await (getProvider('ADOIS_PORTAL') as AdoisPortalProvider).discoverPartnerEntities(url, ctx());
    const entities: EntityRow[] = d.groups.map((g) => ({ tipo: g.type, entidade: g.municipality.toUpperCase(), municipio: g.municipality, uf: g.uf, url, nome_completo: g.name }));
    const invoices = d.groups.flatMap((g) => invoiceRows(g.shortName, g.invoices, g.contracts, overdueAfter));
    return { entities, invoices, warnings: d.warnings, title: `Parceiro ${d.company ?? ''}`.trim() };
  }
  const snap = await getProvider(providerKey).fetchSnapshot({ url, config: null }, ctx());
  const info = entityFromPortalNames(snap.entity.name, snap.entity.shortName);
  if (!info) throw badRequest('Não foi possível identificar o nome da entidade na página do portal');
  const uf = (snap.entity.uf ?? '').toUpperCase();
  const entities: EntityRow[] = [{ tipo: info.type, entidade: info.municipality.toUpperCase(), municipio: info.municipality, uf, url, nome_completo: info.name }];
  return { entities, invoices: invoiceRows(info.shortName, snap.invoices, snap.contracts, overdueAfter), warnings: snap.warnings, title: info.name };
}

function header(ws: ExcelJS.Worksheet): void {
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F5FAE' } };
  head.alignment = { vertical: 'middle' };
}

export async function buildImportWorkbook(url?: string | null): Promise<{ buffer: Buffer; fileName: string }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Siow System';
  const linked = url ? await rowsFromLink(url) : null;

  const ws = wb.addWorksheet('Entidades', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'tipo', key: 'tipo', width: 12 },
    { header: 'entidade', key: 'entidade', width: 28 },
    { header: 'municipio', key: 'municipio', width: 28 },
    { header: 'uf', key: 'uf', width: 6 },
    { header: 'url', key: 'url', width: 70 },
    { header: 'nome_completo', key: 'nome_completo', width: 48 },
  ];
  header(ws);
  for (const r of linked?.entities ?? []) ws.addRow(r);
  for (let r = 2; r <= Math.max(500, (linked?.entities.length ?? 0) + 2); r += 1) {
    ws.getCell(`A${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${ENTITY_TYPES.join(',')}"`], showErrorMessage: true, errorTitle: 'Tipo inválido', error: `Use um destes: ${ENTITY_TYPES.join(', ')}` };
    ws.getCell(`D${r}`).dataValidation = { type: 'textLength', operator: 'equal', allowBlank: true, formulae: [2], showErrorMessage: true, errorTitle: 'UF inválida', error: 'Informe a sigla do estado com 2 letras (ex.: MA)' };
  }
  ws.autoFilter = 'A1:F1';

  const notes = wb.addWorksheet('Notas', { views: [{ state: 'frozen', ySplit: 1 }] });
  notes.columns = [
    { header: 'entidade', key: 'entidade', width: 22 },
    { header: 'numero', key: 'numero', width: 10 },
    { header: 'competencia', key: 'competencia', width: 13 },
    { header: 'exercicio', key: 'exercicio', width: 10 },
    { header: 'valor', key: 'valor', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'emissao', key: 'emissao', width: 12 },
    { header: 'situacao', key: 'situacao', width: 11 },
    { header: 'pagamento', key: 'pagamento', width: 12 },
    { header: 'atraso', key: 'atraso', width: 9 },
    { header: 'contrato', key: 'contrato', width: 18 },
    { header: 'cobranca', key: 'cobranca', width: 14 },
    { header: 'descricao', key: 'descricao', width: 70 },
  ];
  header(notes);
  for (const r of linked?.invoices ?? []) {
    const row = notes.addRow(r);
    if (r.situacao === 'Pendente') row.getCell('situacao').font = { color: { argb: 'FFB76E00' }, bold: true };
    if (r.situacao === 'Paga') row.getCell('situacao').font = { color: { argb: 'FF008300' } };
  }
  notes.autoFilter = 'A1:L1';

  const help = wb.addWorksheet('Instruções');
  help.columns = [{ width: 18 }, { width: 14 }, { width: 90 }];
  const rows: Array<[string, string, string]> = [
    ['Aba Entidades', '', 'Uma linha por entidade. É a aba usada para CADASTRAR.'],
    ['tipo', 'sim', `Sigla do tipo: ${ENTITY_TYPES.map((t) => `${t} = ${ENTITY_TYPE_LABELS[t]}`).join('; ')}.`],
    ['entidade', 'sim', 'Nome curto, sem o tipo (ex.: BOM LUGAR). O sistema monta "CM BOM LUGAR" a partir do tipo + entidade.'],
    ['municipio', 'não', 'Nome do município. Em branco, usa "entidade".'],
    ['uf', 'sim', 'Sigla do estado com 2 letras (MA, PI, TO…).'],
    ['url', 'sim', 'Link web da entidade no Portal do Cliente (Assesi …&t=1 ou Adois …&t=1). Em links de PARCEIRO da Adois (…&t=2) a mesma URL vale para todas as entidades do link.'],
    ['nome_completo', 'não', 'Nome oficial (ex.: CÂMARA MUNICIPAL DE BOM LUGAR). Em branco, o sistema monta a partir do tipo + entidade.'],
    ['', '', ''],
    ['Aba Notas', '', 'Mesmas colunas da tela de Notas fiscais. Quando a planilha é baixada a partir de um link, vem com TODAS as notas do portal (pendentes e pagas). Na importação, notas cuja entidade (coluna "entidade" = nome curto ou nome completo) exista no sistema e cujo número ainda não esteja cadastrado são incluídas como importadas; as demais são ignoradas. A sincronização com o portal continua sendo a fonte: ela atualiza as notas importadas.'],
    ['numero', 'sim', 'Número da nota no portal.'],
    ['competencia', 'sim', 'MM/AAAA (ex.: 09/2026).'],
    ['valor', 'sim', 'Valor em reais (1320,00 ou 1320.00).'],
    ['emissao / pagamento', 'não', 'Datas dd/mm/aaaa. "pagamento" preenchido = nota paga.'],
    ['situacao', 'não', 'Pendente ou Paga. Em branco: Paga se houver data de pagamento, senão Pendente.'],
    ['contrato', 'não', 'Número do contrato (se já cadastrado na entidade, a nota é vinculada a ele).'],
    ['atraso / cobranca', 'não', 'Informativos: calculados pelo sistema; não são importados.'],
    ['', '', ''],
    ['Depois', '', 'Envie o arquivo em Entidades → Importar entidade → Importar planilha, e clique em "Sincronizar todas" para o sistema conferir tudo com o portal.'],
  ];
  if (linked) rows.unshift([linked.title, '', `Planilha gerada pelo sistema em ${formatBrDate(todayIso())} a partir de ${url}. ${linked.entities.length} entidade(s), ${linked.invoices.length} nota(s).${linked.warnings.length ? ' Avisos: ' + linked.warnings.join(' | ') : ''}`], ['', '', '']);
  rows.forEach((r) => {
    const row = help.addRow(r);
    row.alignment = { wrapText: true, vertical: 'top' };
    if (/^Aba |^Depois|^Parceiro|MUNICIPAL/.test(r[0]) || r[0] === linked?.title) row.font = { bold: true };
  });

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const slug = linked ? linked.entities[0]?.entidade.toLowerCase().replace(/[^a-z0-9]+/g, '-') ?? 'link' : 'modelo';
  return { buffer, fileName: linked ? `entidades-${slug}.xlsx` : 'modelo-importacao-entidades.xlsx' };
}
