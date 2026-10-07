'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { formatBRL, formatBrDate, formatBrDateTime } from '@siow/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { downloadBlob } from '@/lib/utils';
import { GlobalFilters, type Filters } from '@/components/global-filters';
import { Button, Card, Empty, Select, Table, Td, Th } from '@/components/ui';

interface ReportResult { key: string; title: string; generatedAt: string; period: string; columns: Array<{ key: string; label: string; type?: string }>; rows: Array<Record<string, string | number | null>>; totals?: Record<string, string | number> }

const cell = (v: string | number | null, type?: string): string => (v === null || v === '' ? '' : type === 'money' ? formatBRL(v) : type === 'date' ? formatBrDate(String(v)) : String(v));

export default function ReportsPage() {
  const { can } = useAuth();
  const [report, setReport] = useState('financial_overview');
  const [filters, setFilters] = useState<Filters>({});
  const { data: catalog } = useQuery({ queryKey: ['report-catalog'], queryFn: () => api<Array<{ key: string; label: string }>>('/financeiro/reports/catalog') });
  const query = { ...filters, report } as Record<string, string | number | undefined>;
  const { data, isFetching, refetch } = useQuery({ queryKey: ['report', query], queryFn: () => api<ReportResult>('/financeiro/reports', { query: { ...query, format: 'json' } }), enabled: false });
  const exportAs = useMutation({
    mutationFn: async (format: 'csv' | 'xlsx' | 'pdf') => {
      const blob = await api<Blob>('/financeiro/reports', { query: { ...query, format }, raw: true });
      downloadBlob(blob, `${report}-${new Date().toISOString().slice(0, 10)}.${format}`);
    },
  });
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Central de relatórios</h1>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={report} onChange={(e) => setReport(e.target.value)} className="w-80">{catalog?.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</Select>
        <Button onClick={() => refetch()} disabled={isFetching}>{isFetching ? 'Gerando…' : 'Gerar'}</Button>
        {can('reports.export') && (
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={() => exportAs.mutate('pdf')} disabled={exportAs.isPending}>PDF</Button>
            <Button variant="secondary" onClick={() => exportAs.mutate('xlsx')} disabled={exportAs.isPending}>XLSX</Button>
            <Button variant="secondary" onClick={() => exportAs.mutate('csv')} disabled={exportAs.isPending}>CSV</Button>
          </div>
        )}
      </div>
      <GlobalFilters value={filters} onChange={setFilters} />
      {data && (
        <Card>
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-3">
            <div><div className="font-semibold">{data.title}</div><div className="text-xs text-ink-3">Período de referência: {data.period} · gerado em {formatBrDateTime(data.generatedAt)}</div></div>
            {data.totals && <div className="text-xs text-ink-2">{Object.entries(data.totals).map(([k, v]) => <span key={k} className="mr-3">{k}: <strong>{typeof v === 'string' && /^\d+\.\d{2}$/.test(v) ? formatBRL(v) : v}</strong></span>)}</div>}
          </div>
          {data.rows.length === 0 ? <div className="p-4"><Empty>Sem dados para os filtros</Empty></div> : (
            <Table>
              <thead><tr>{data.columns.map((c) => <Th key={c.key} className={c.type === 'money' || c.type === 'number' ? 'text-right' : ''}>{c.label}</Th>)}</tr></thead>
              <tbody>{data.rows.map((r, i) => <tr key={i}>{data.columns.map((c) => <Td key={c.key} className={c.type === 'money' || c.type === 'number' ? 'text-right tabular-nums' : ''}>{cell(r[c.key] ?? null, c.type)}</Td>)}</tr>)}</tbody>
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}
