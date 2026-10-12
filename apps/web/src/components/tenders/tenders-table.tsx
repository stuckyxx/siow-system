'use client';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { TENDER_MODALITIES, TENDER_MODALITY_LABELS, TENDER_STATUSES, TENDER_STATUS_LABELS, formatBRL, formatBrDateTime, type Paginated, type TenderModality, type TenderRow, type TenderStatus } from '@siow/shared';
import { api } from '@/lib/api';
import { Badge, Empty, Input, Pagination, Select, Table, Td, Th } from '@/components/ui';

export const STATUS_TONE: Record<string, 'info' | 'warn' | 'good' | 'critical' | 'neutral'> = { IDENTIFIED: 'neutral', ANALYZING: 'info', PREPARING: 'info', SUBMITTED: 'warn', IN_SESSION: 'warn', WON: 'good', HOMOLOGATED: 'good', LOST: 'critical', CANCELLED: 'neutral', DESERTED: 'neutral', NOT_PARTICIPATING: 'neutral' };
export function TenderStatusBadge({ status }: { status: string }) { return <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{TENDER_STATUS_LABELS[status as TenderStatus] ?? status}</Badge>; }

/** Lista de licitações com filtros; `entityId` restringe à entidade (aba da ficha). */
export function TendersTable({ entityId, compact }: { entityId?: string; compact?: boolean }) {
  const router = useRouter();
  const [f, setF] = useState({ q: '', status: '', modality: '', open: !compact, page: 1 });
  const query = { entityId, q: f.q || undefined, status: f.status || undefined, modality: f.modality || undefined, open: f.open && !f.status ? 'true' : undefined, page: f.page, pageSize: compact ? 10 : 25 };
  const { data } = useQuery({ queryKey: ['tenders', query], queryFn: () => api<Paginated<TenderRow>>('/licitacoes', { query }) });
  return (
    <div>
      {!compact && (
        <div className="grid gap-2" style={{ gridTemplateColumns: '2fr 1fr 1fr auto', alignItems: 'center', marginBottom: 10 }}>
          <Input placeholder="Buscar número, objeto, entidade ou id PNCP" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value, page: 1 })} style={{ minWidth: 300 }} />
          <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })}><option value="">Em andamento</option>{TENDER_STATUSES.map((s) => <option key={s} value={s}>{TENDER_STATUS_LABELS[s]}</option>)}</Select>
          <Select value={f.modality} onChange={(e) => setF({ ...f, modality: e.target.value, page: 1 })}><option value="">Todas as modalidades</option>{TENDER_MODALITIES.map((m) => <option key={m} value={m}>{TENDER_MODALITY_LABELS[m]}</option>)}</Select>
          <label className="row small" style={{ gap: 4 }}><input type="checkbox" checked={!f.open} onChange={(e) => setF({ ...f, open: !e.target.checked, page: 1 })} /> Incluir encerradas</label>
        </div>
      )}
      <div className="card">
        {!data ? <div className="bd small muted">Carregando…</div> : data.items.length === 0 ? <div className="bd"><Empty>Nenhuma licitação</Empty></div> : (
          <div className="tbl"><Table>
            <thead><tr><Th>Licitação</Th>{!entityId && <Th>Entidade</Th>}<Th>Situação</Th><Th>Sessão</Th><Th className="hide-m">Próximo prazo</Th><Th className="r">Valor estimado</Th><Th className="r hide-m">Checklist</Th></tr></thead>
            <tbody>{data.items.map((t) => (
              <tr key={t.id} className="click" onClick={() => router.push(`/licitacoes/${t.id}`)}>
                <Td><span className="link">{TENDER_MODALITY_LABELS[t.modality as TenderModality] ?? t.modality} {t.number}{t.year ? `/${t.year}` : ''}</span><div className="small muted" style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.object}</div></Td>
                {!entityId && <Td>{t.entity.shortName ?? t.entity.name}<div className="small muted">{t.entity.municipality}/{t.entity.uf}</div></Td>}
                <Td><TenderStatusBadge status={t.status} />{t.source !== 'MANUAL' && <div className="small muted">{t.source}</div>}</Td>
                <Td className="num small">{t.sessionAt ? formatBrDateTime(t.sessionAt) : t.proposalDeadline ? `proposta até ${formatBrDateTime(t.proposalDeadline)}` : '—'}</Td>
                <Td className="small hide-m">{t.nextDeadline ? <span style={{ color: t.nextDeadline.overdue ? 'var(--crit)' : undefined }}>{t.nextDeadline.title} · {formatBrDateTime(t.nextDeadline.dueAt)}</span> : <span className="muted">—</span>}</Td>
                <Td className="r num">{t.estimatedValue ? formatBRL(t.estimatedValue) : '—'}</Td>
                <Td className="r num hide-m">{t.checklistTotal ? `${t.checklistDone}/${t.checklistTotal}` : '—'}</Td>
              </tr>))}</tbody>
          </Table></div>
        )}
        {data && data.total > data.pageSize && <div className="bd"><Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setF({ ...f, page: p })} /></div>}
      </div>
    </div>
  );
}
