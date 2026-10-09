import ExcelJS from 'exceljs';
import { ENTITY_TYPES, ENTITY_TYPE_LABELS } from '@siow/shared';
import { route } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/financeiro/entities/import-template — modelo XLSX para a importação em lote.
 * Aba "Entidades": cabeçalhos aceitos por importBatch (tipo, entidade, municipio, uf, url, nome_completo),
 * lista suspensa em "tipo" e validação da UF. Aba "Instruções": o que preencher em cada coluna e exemplos.
 */
export const GET = route(['entities.write'], async () => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Siow System';
  const ws = wb.addWorksheet('Entidades', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'tipo', key: 'tipo', width: 12 },
    { header: 'entidade', key: 'entidade', width: 28 },
    { header: 'municipio', key: 'municipio', width: 28 },
    { header: 'uf', key: 'uf', width: 6 },
    { header: 'url', key: 'url', width: 70 },
    { header: 'nome_completo', key: 'nome_completo', width: 48 },
  ];
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F5FAE' } };
  head.alignment = { vertical: 'middle' };
  for (let r = 2; r <= 500; r += 1) {
    ws.getCell(`A${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${ENTITY_TYPES.join(',')}"`], showErrorMessage: true, errorTitle: 'Tipo inválido', error: `Use um destes: ${ENTITY_TYPES.join(', ')}` };
    ws.getCell(`D${r}`).dataValidation = { type: 'textLength', operator: 'equal', allowBlank: true, formulae: [2], showErrorMessage: true, errorTitle: 'UF inválida', error: 'Informe a sigla do estado com 2 letras (ex.: MA)' };
  }
  ws.autoFilter = 'A1:F1';

  const help = wb.addWorksheet('Instruções');
  help.columns = [{ width: 18 }, { width: 14 }, { width: 90 }];
  const rows: Array<[string, string, string]> = [
    ['Coluna', 'Obrigatória', 'O que preencher'],
    ['tipo', 'sim', `Sigla do tipo da entidade: ${ENTITY_TYPES.map((t) => `${t} = ${ENTITY_TYPE_LABELS[t]}`).join('; ')}.`],
    ['entidade', 'sim', 'Nome curto, sem o tipo (ex.: BOM LUGAR, ARAIOSES). O sistema monta "CM BOM LUGAR" a partir do tipo + entidade.'],
    ['municipio', 'não', 'Nome do município. Se ficar em branco, usa o valor de "entidade".'],
    ['uf', 'sim', 'Sigla do estado com 2 letras (MA, PI, TO…).'],
    ['url', 'sim', 'Link web da entidade no Portal do Cliente: Assesi (https://www.assesi.com.br/adm_faturas/index.php?e=…&t=1) ou Adois (https://adoissolucoes.com/adm_faturas/index.php?e=…&t=1). Links de PARCEIRO da Adois (…&t=2) não entram na planilha: use o campo "link web" em Importar entidade.'],
    ['nome_completo', 'não', 'Nome oficial (ex.: CÂMARA MUNICIPAL DE BOM LUGAR). Se ficar em branco, o sistema monta a partir do tipo + entidade.'],
    ['', '', ''],
    ['Regras', '', 'Uma linha por entidade. Entidade já existente (mesmo tipo + município + UF) é reaproveitada e só a URL nova é cadastrada. Depois de importar, clique em "Sincronizar todas" para buscar as notas.'],
    ['', '', ''],
    ['Exemplos', '', ''],
    ['CM', '', 'BOM LUGAR | Bom Lugar | MA | https://www.assesi.com.br/adm_faturas/index.php?e=504673&t=1 | CÂMARA MUNICIPAL DE BOM LUGAR'],
    ['PM', '', 'TUNTUM | Tuntum | MA | https://adoissolucoes.com/adm_faturas/index.php?e=514061&t=1 | PREFEITURA MUNICIPAL DE TUNTUM'],
  ];
  rows.forEach((r, i) => {
    const row = help.addRow(r);
    row.alignment = { wrapText: true, vertical: 'top' };
    if (i === 0) { row.font = { bold: true, color: { argb: 'FFFFFFFF' } }; row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F5FAE' } }; }
    if (r[0] === 'Regras' || r[0] === 'Exemplos') row.font = { bold: true };
  });

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="modelo-importacao-entidades.xlsx"',
      'Cache-Control': 'no-store',
    },
  });
});
