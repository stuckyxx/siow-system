'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { formatBRL, formatBrDate, formatBrDateTime } from '@siow/shared';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { downloadBlob } from '@/lib/utils';
import { GlobalFilters, useFilterOptions, useGlobalFilters } from '@/components/global-filters';
import { useToast } from '@/components/ui';

interface ReportResult { key: string; title: string; generatedAt: string; period: string; columns: Array<{ key: string; label: string; type?: string }>; rows: Array<Record<string, string | number | null>>; totals?: Record<string, string | number> }

const cell = (v: string | number | null, type?: string): string => (v === null || v === '' ? '' : type === 'money' ? formatBRL(v) : type === 'date' ? formatBrDate(String(v)) : String(v));
const TOTAL_LABEL: Record<string, string> = { monthly: 'Receita prevista mensal', annual: 'Receita prevista anual', contracts: 'Contratos ativos', debt: 'Total em débito', pending: 'Total pendente', received: 'Total recebido', paid: 'Total pago', count: 'Registros', invoices: 'Notas', amount: 'Valor total' };
const isMoney = (k: string, v: string | number): boolean => typeof v === 'string' && /^-?\d+\.\d{2}$/.test(v) && !/count|contracts|invoices|days/i.test(k);

export default function ReportsPage() {
  return <Suspense fallback={<div className="muted">Carregando…</div>}><Reports /></Suspense>;
}

function Reports() {
  const { can, user } = useAuth();
  const search = useSearchParams();
  const [report, setReport] = useState(search.get('r') ?? 'financial_overview');
  const [filters, setFilters] = useGlobalFilters();
  const [toast, showToast] = useToast();
  const { data: options } = useFilterOptions();

  // Busca rápida / dashboard podem abrir um relatório já com entidade e exercício.
  useEffect(() => {
    const entityId = search.get('entityId');
    const year = search.get('year');
    if (entityId || year) setFilters({ ...filters, ...(entityId ? { entityId } : {}), ...(year ? { year: Number(year) } : {}) });
  }, [search]);

  const { data: catalog } = useQuery({ queryKey: ['report-catalog'], queryFn: () => api<Array<{ key: string; label: string }>>('/financeiro/reports/catalog') });
  const query = { ...filters, report } as Record<string, string | number | undefined>;
  const { data, isFetching, error } = useQuery({ queryKey: ['report', query], queryFn: () => api<ReportResult>('/financeiro/reports', { query: { ...query, format: 'json' } }) });
  const exportAs = useMutation({
    mutationFn: async (format: 'csv' | 'xlsx' | 'pdf') => {
      const blob = await api<Blob>('/financeiro/reports', { query: { ...query, format }, raw: true });
      downloadBlob(blob, `${report}-${new Date().toISOString().slice(0, 10)}.${format}`);
    },
    onError: (e) => showToast(e instanceof ApiError ? e.message : 'Falha ao exportar'),
  });

  const ent = options?.entities.find((e) => e.id === filters.entityId);
  const scope = ent ? (ent.shortName ?? ent.name) : filters.entityType ? `Entidades do tipo ${filters.entityType}` : 'Todas as entidades';
  const numeric = (t?: string): boolean => t === 'money' || t === 'number';

  return (
    <div>
      <div className="row between">
        <div>
          <h1>Relatórios</h1>
          <p className="sub">Escolha o relatório, ajuste os filtros e veja a pré-visualização antes de exportar</p>
        </div>
        {can('reports.export') && (
          <span className="row">
            <button className="btn p" onClick={() => exportAs.mutate('pdf')} disabled={exportAs.isPending}>Exportar PDF</button>
            <button className="btn" onClick={() => exportAs.mutate('xlsx')} disabled={exportAs.isPending}>XLSX</button>
            <button className="btn" onClick={() => exportAs.mutate('csv')} disabled={exportAs.isPending}>CSV</button>
          </span>
        )}
      </div>
      <div className="row" style={{ marginBottom: 10 }}>
        <select value={report} onChange={(e) => setReport(e.target.value)} style={{ minWidth: 280 }} aria-label="Relatório">
          {catalog?.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        {isFetching && <span className="small muted">Gerando…</span>}
      </div>
      <GlobalFilters value={filters} onChange={setFilters} />

      {error && <div className="alert crit">{error instanceof ApiError ? error.message : 'Falha ao gerar o relatório'}</div>}
      {data && (
        <div className="paperwrap">
          <div className="paper">
            <div className="ph">
              <div className="row" style={{ gap: 16, alignItems: 'center' }}>
                <img src="/logo.png" alt="Siow System" style={{ height: 40 }} />
                <div>
                  <h3>{data.title}</h3>
                  <div className="co">Siow System Tecnologia · Módulo Financeiro</div>
                </div>
              </div>
              <div className="meta">
                <div>Período: {data.period}</div>
                <div>Recorte: {scope}{filters.year ? ` · ${filters.year}` : ''}</div>
                <div>Gerado em {formatBrDateTime(data.generatedAt)}{user ? ` por ${user.name}` : ''}</div>
              </div>
            </div>
            <div className="pb">
              <div className="kpis">
                {data.totals && Object.keys(data.totals).length > 0
                  ? Object.entries(data.totals).map(([k, v]) => <div key={k} className="kpi"><div className="l">{TOTAL_LABEL[k] ?? k}</div><div className="v">{isMoney(k, v) ? formatBRL(v) : v}</div></div>)
                  : <div className="kpi"><div className="l">Registros</div><div className="v">{data.rows.length}</div></div>}
              </div>
              {data.rows.length === 0 ? <p style={{ color: '#5a6472' }}>Sem dados para os filtros selecionados.</p> : (
                <div className="tbl">
                  <table>
                    <thead><tr>{data.columns.map((c) => <th key={c.key} className={numeric(c.type) ? 'r' : ''}>{c.label}</th>)}</tr></thead>
                    <tbody>{data.rows.map((r, i) => <tr key={i}>{data.columns.map((c) => <td key={c.key} className={numeric(c.type) ? 'r num' : ''}>{cell(r[c.key] ?? null, c.type)}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="pf"><span>Fonte: sincronização automática com o Portal do Cliente</span><span>{data.rows.length} registro(s)</span></div>
          </div>
        </div>
      )}
      {toast}
    </div>
  );
}
