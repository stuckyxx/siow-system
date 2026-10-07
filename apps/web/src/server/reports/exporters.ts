/**
 * Exportadores da central de relatórios: CSV (texto), XLSX (exceljs) e PDF (pdfkit).
 * Todos recebem o mesmo ReportResult devolvido ao frontend em JSON.
 */
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { formatBRL, formatBrDate, formatBrDateTime } from '@siow/shared';
import type { ReportResult } from '../services/reports.js';
import { LOGO_PNG } from './logo.js';

function cell(value: string | number | null, type?: string): string {
  if (value === null || value === undefined || value === '') return '';
  if (type === 'money') return formatBRL(value);
  if (type === 'date') return formatBrDate(String(value));
  return String(value);
}

/** Evita injeção de fórmula em planilhas: células iniciadas por = + - @ ganham apóstrofo. */
function safeSpreadsheetText(v: string): string {
  return /^[=+\-@]/.test(v) ? `'${v}` : v;
}

const fmtTotal = (v: string | number): string => (typeof v === 'string' && /^\d+\.\d{2}$/.test(v) ? formatBRL(v) : String(v));

export function toCsv(r: ReportResult): Buffer {
  const esc = (v: string): string => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [
    `# ${r.title} — ${r.period} — gerado em ${formatBrDateTime(r.generatedAt)}`,
    r.columns.map((c) => esc(c.label)).join(';'),
    ...r.rows.map((row) => r.columns.map((c) => esc(safeSpreadsheetText(cell(row[c.key] ?? null, c.type)))).join(';')),
  ];
  return Buffer.from('﻿' + lines.join('\r\n'), 'utf8');
}

export async function toXlsx(r: ReportResult): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Siow System';
  const ws = wb.addWorksheet(r.title.slice(0, 30));
  ws.addRow([r.title]).font = { bold: true, size: 14 };
  ws.addRow([`Período: ${r.period}`]);
  ws.addRow([`Gerado em: ${formatBrDateTime(r.generatedAt)}`]);
  ws.addRow([]);
  const header = ws.addRow(r.columns.map((c) => c.label));
  header.font = { bold: true };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9EEF6' } };
  for (const row of r.rows) {
    const values = r.columns.map((c) => {
      const v = row[c.key] ?? null;
      if (v === null || v === '') return null;
      if (c.type === 'money' || c.type === 'number') return Number(v);
      if (c.type === 'date') return new Date(`${String(v)}T00:00:00`);
      return typeof v === 'string' ? safeSpreadsheetText(v) : v;
    });
    const added = ws.addRow(values);
    r.columns.forEach((c, i) => {
      const cellRef = added.getCell(i + 1);
      if (c.type === 'money') cellRef.numFmt = '"R$" #,##0.00';
      if (c.type === 'date') cellRef.numFmt = 'dd/mm/yyyy';
    });
  }
  if (r.totals) {
    ws.addRow([]);
    ws.addRow(['Totais', ...Object.entries(r.totals).map(([k, v]) => `${k}: ${fmtTotal(v)}`)]).font = { bold: true };
  }
  ws.columns.forEach((col) => {
    col.width = Math.min(50, Math.max(12, ...(col.values ?? []).map((v) => String(v ?? '').length + 2)));
  });
  ws.views = [{ state: 'frozen', ySplit: 5 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function toPdf(r: ReportResult): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: r.columns.length > 6 ? 'landscape' : 'portrait', margin: 36 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Cabeçalho no padrão do protótipo: faixa em gradiente com a logo, título, empresa, período e data de geração.
    const bandH = 70;
    const grad = doc.linearGradient(0, 0, doc.page.width, bandH);
    grad.stop(0, '#0f2a5a').stop(1, '#3b1f8a');
    doc.rect(0, 0, doc.page.width, bandH).fill(grad);
    doc.image(LOGO_PNG, doc.page.margins.left, 14, { height: 42 });
    const textX = doc.page.margins.left + 118;
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(15).text(r.title, textX, 18, { width: doc.page.width - textX - 190 });
    doc.font('Helvetica').fontSize(8.5).fillColor('#dbe4ff').text('Siow System Tecnologia · Módulo Financeiro', textX, 40);
    doc.fontSize(8).text(`Período: ${r.period}`, doc.page.width - 200, 22, { width: 164, align: 'right' }).text(`Gerado em ${formatBrDateTime(r.generatedAt)}`, doc.page.width - 200, 36, { width: 164, align: 'right' });
    doc.fillColor('#000').font('Helvetica');
    doc.y = bandH + 18;
    doc.x = doc.page.margins.left;

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colWidth = pageWidth / Math.max(1, r.columns.length);
    const rowHeight = 16;
    let y = doc.y;

    const drawHeader = (): void => {
      doc.fontSize(8).font('Helvetica-Bold');
      r.columns.forEach((c, i) => doc.text(c.label, doc.page.margins.left + i * colWidth, y, { width: colWidth - 4, ellipsis: true }));
      y += rowHeight;
      doc.moveTo(doc.page.margins.left, y - 3).lineTo(doc.page.margins.left + pageWidth, y - 3).strokeColor('#999').stroke();
      doc.font('Helvetica');
    };
    drawHeader();
    for (const row of r.rows) {
      if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        y = doc.page.margins.top;
        drawHeader();
      }
      r.columns.forEach((c, i) => {
        const v = cell(row[c.key] ?? null, c.type);
        doc.fontSize(8).text(v, doc.page.margins.left + i * colWidth, y, { width: colWidth - 4, ellipsis: true, align: c.type === 'money' || c.type === 'number' ? 'right' : 'left' });
      });
      y += rowHeight;
    }
    if (r.totals) {
      y += 6;
      doc.fontSize(9).font('Helvetica-Bold').text(
        'Totais: ' + Object.entries(r.totals).map(([k, v]) => `${k} = ${fmtTotal(v)}`).join('   '),
        doc.page.margins.left,
        y,
      );
    }
    doc.end();
  });
}
