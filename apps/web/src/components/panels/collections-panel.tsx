'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { COLLECTION_STATUSES, COLLECTION_STATUS_LABELS, formatBRL, formatBrDate, formatCompetence, type CollectionStatus } from '@siow/shared';
import { api } from '@/lib/api';
import { InvoiceDialog } from '../invoice-dialog';
import { CollectionStatusBadge, InvoiceStatusBadge } from '../status';
import { Button, Card, Empty, Select, Table, Td, Th } from '../ui';

interface CaseRow {
  id: string; status: CollectionStatus; nextActionAt: string | null; nextActionNote: string | null; lastAttemptAt: string | null; promisedPaymentDate: string | null;
  entity: { id: string; name: string; shortName: string | null }; invoice: { id: string; number: string; amount: string; status: 'PENDING' | 'PAID' | 'CANCELLED' | 'UNKNOWN'; competenceMonth: number; competenceYear: number };
  assignee: { name: string } | null; _count: { attempts: number };
}

/** Cobranças (spec §17): status próprio, independente do status da nota. */
export function CollectionsPanel({ entityId }: { entityId?: string }) {
  const [status, setStatus] = useState('');
  const [dueOnly, setDueOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const { data, refetch } = useQuery({ queryKey: ['collections', entityId, status, dueOnly], queryFn: () => api<CaseRow[]>('/financeiro/collections', { query: { entityId, status: status || undefined, dueOnly: dueOnly || undefined } }) });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-52"><option value="">Todos os status de cobrança</option>{COLLECTION_STATUSES.map((s) => <option key={s} value={s}>{COLLECTION_STATUS_LABELS[s]}</option>)}</Select>
        <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={dueOnly} onChange={(e) => setDueOnly(e.target.checked)} /> Somente com ação vencida</label>
        <span className="text-xs text-ink-3">Para cobrar uma nota, abra-a na aba Notas fiscais → Cobrança.</span>
      </div>
      <Card>
        {!data ? <div className="p-4 text-sm text-ink-3">Carregando…</div> : data.length === 0 ? <div className="p-4"><Empty>Nenhuma cobrança registrada</Empty></div> : (
          <Table>
            <thead><tr>{!entityId && <Th>Entidade</Th>}<Th>Nota</Th><Th className="text-right">Valor</Th><Th>Nota</Th><Th>Cobrança</Th><Th>Tentativas</Th><Th>Última</Th><Th>Próxima ação</Th><Th>Responsável</Th><Th></Th></tr></thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="hover:bg-surface">
                  {!entityId && <Td><Link href={`/financeiro/entidades/${c.entity.id}`} className="hover:underline">{c.entity.shortName ?? c.entity.name}</Link></Td>}
                  <Td className="tabular-nums">{c.invoice.number} · {formatCompetence({ competenceMonth: c.invoice.competenceMonth, competenceYear: c.invoice.competenceYear })}</Td>
                  <Td className="text-right tabular-nums">{formatBRL(c.invoice.amount)}</Td>
                  <Td><InvoiceStatusBadge status={c.invoice.status} /></Td>
                  <Td><CollectionStatusBadge status={c.status} /></Td>
                  <Td className="text-center">{c._count.attempts}</Td>
                  <Td className="tabular-nums">{c.lastAttemptAt ? formatBrDate(c.lastAttemptAt.slice(0, 10)) : '—'}</Td>
                  <Td className="tabular-nums">{c.nextActionAt ? formatBrDate(c.nextActionAt) : '—'}{c.promisedPaymentDate && <div className="text-xs text-ink-3">promessa: {formatBrDate(c.promisedPaymentDate)}</div>}</Td>
                  <Td className="text-ink-2">{c.assignee?.name ?? '—'}</Td>
                  <Td><Button size="sm" variant="ghost" onClick={() => setOpen(c.invoice.id)}>Abrir</Button></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <InvoiceDialog id={open} onClose={() => { setOpen(null); refetch(); }} />
    </div>
  );
}
