'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { MONTH_NAMES_PT, formatBRL, formatBrDate, formatCompetence, type InvoiceRow, type Paginated } from '@siow/shared';
import { api } from '@/lib/api';
import { InvoiceDialog } from './invoice-dialog';
import { CollectionStatusBadge, InvoiceStatusBadge } from './status';
import { Badge, Button, Card, Empty, Input, Pagination, Select, Table, Td, Th } from './ui';

export type InvoiceQuery = Record<string, string | number | boolean | undefined>;

/** Tabela de notas (spec §11) — usada na tela geral e na ficha da entidade. */
export function InvoicesTable({ base, showEntity = true, initialOpenId }: { base?: InvoiceQuery; showEntity?: boolean; initialOpenId?: string | null }) {
  const [status, setStatus] = useState<'PENDING' | 'PAID' | 'ALL'>(initialOpenId ? 'ALL' : 'PENDING');
  const [q, setQ] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('issueDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [open, setOpen] = useState<string | null>(initialOpenId ?? null);

  const query: InvoiceQuery = { ...base, status, q: q || undefined, month: month || undefined, year: year || undefined, competenceFrom: from || undefined, competenceTo: to || undefined, page, pageSize: 25, sortBy, sortDir };
  const { data, isLoading, refetch } = useQuery({ queryKey: ['invoices', query], queryFn: () => api<Paginated<InvoiceRow> & { totals: { amount: string; count: number } }>('/financeiro/invoices', { query }) });

  const th = (key: string, label: string, right = false) => (
    <Th className={right ? 'text-right' : ''}><button onClick={() => { if (sortBy === key) setSortDir(sortDir === 'desc' ? 'asc' : 'desc'); else { setSortBy(key); setSortDir('desc'); } }}>{label}{sortBy === key ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}</button></Th>
  );
  const years = Array.from({ length: 8 }, (_, i) => new Date().getFullYear() - i);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="seg">
          {(['PENDING', 'PAID', 'ALL'] as const).map((s) => (
            <button key={s} onClick={() => { setStatus(s); setPage(1); }} className={status === s ? 'on' : ''}>{s === 'PENDING' ? 'Pendentes' : s === 'PAID' ? 'Pagas' : 'Todas'}</button>
          ))}
        </div>
        {showEntity && <Input placeholder="Buscar nº da nota, entidade, contrato" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="w-64" />}
        <Select value={month} onChange={(e) => { setMonth(e.target.value); setPage(1); }} className="w-32"><option value="">Mês</option>{MONTH_NAMES_PT.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select>
        <Select value={year} onChange={(e) => { setYear(e.target.value); setPage(1); }} className="w-28"><option value="">Ano</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</Select>
        <Input type="month" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="w-36" aria-label="De" />
        <Input type="month" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="w-36" aria-label="Até" />
        {data && <span className="ml-auto text-sm text-ink-2">{data.totals.count} nota(s) · <strong className="tabular-nums">{formatBRL(data.totals.amount)}</strong></span>}
      </div>
      <Card>
        {isLoading ? <div className="p-6 text-sm text-ink-3">Carregando…</div> : !data || data.items.length === 0 ? <div className="p-6"><Empty>Nenhuma nota para os filtros</Empty></div> : (
          <Table>
            <thead><tr>{th('number', 'Nº')}{showEntity && <Th>Entidade</Th>}{th('competence', 'Competência')}<Th className="hide-m">Exercício</Th>{th('amount', 'Valor', true)}{th('issueDate', 'Emissão')}<Th>Situação</Th>{th('paidAt', 'Pagamento')}<Th className="text-right">Atraso</Th><Th className="hide-m">Contrato</Th><Th>Cobrança</Th><Th></Th></tr></thead>
            <tbody>
              {data.items.map((i) => (
                <tr key={i.id} className="hover:bg-surface">
                  <Td className="font-medium tabular-nums"><button className="text-brand hover:underline" onClick={() => setOpen(i.id)}>{i.number}</button>{i.needsReconciliation && <Badge tone="critical" className="ml-1">verificar</Badge>}{i.manualOverride && <Badge tone="info" className="ml-1">manual</Badge>}</Td>
                  {showEntity && <Td><Link href={`/financeiro/entidades/${i.entityId}`} className="hover:underline">{i.entityName}</Link></Td>}
                  <Td className="tabular-nums">{formatCompetence({ competenceMonth: i.competenceMonth, competenceYear: i.competenceYear })}</Td>
                  <Td className="tabular-nums hide-m">{i.competenceYear}</Td>
                  <Td className="text-right tabular-nums">{formatBRL(i.amount)}</Td>
                  <Td className="tabular-nums">{formatBrDate(i.issueDate)}</Td>
                  <Td><InvoiceStatusBadge status={i.status} /></Td>
                  <Td className="tabular-nums">{formatBrDate(i.paidAt)}</Td>
                  <Td className={`text-right tabular-nums ${i.daysOverdue ? (i.daysOverdue > 60 ? 'text-critical' : 'text-warn') : 'text-ink-3'}`}>{i.daysOverdue ? `${i.daysOverdue} d` : '—'}</Td>
                  <Td className="text-ink-2 hide-m">{i.contractNumber ?? '—'}</Td>
                  <Td>{i.status === 'PENDING' ? <CollectionStatusBadge status={i.collectionStatus} /> : <span className="text-ink-3">—</span>}</Td>
                  <Td><Button size="sm" variant="ghost" onClick={() => setOpen(i.id)}>Abrir</Button></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {data && <div className="px-3"><Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} /></div>}
      </Card>
      <InvoiceDialog id={open} onClose={() => { setOpen(null); refetch(); }} />
    </div>
  );
}
