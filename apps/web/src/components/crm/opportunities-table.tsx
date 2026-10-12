'use client';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { OPPORTUNITY_SOURCE_LABELS, OPPORTUNITY_STATUS_LABELS, formatBRL, formatBrDate, type OpportunityRow, type OpportunitySource, type Paginated } from '@siow/shared';
import { api } from '@/lib/api';
import { useAssignees } from '@/components/panels/tasks-panel';
import { Badge, Empty, Input, Pagination, Select, Table, Td, Th } from '@/components/ui';
import { usePipelines } from './opportunity-form';

export function StatusBadge({ o }: { o: OpportunityRow }) {
  return <Badge tone={o.status === 'WON' ? 'good' : o.status === 'LOST' ? 'critical' : o.stalled ? 'warn' : 'info'}>{o.status === 'OPEN' ? o.stage.name : OPPORTUNITY_STATUS_LABELS[o.status]}{o.stalled ? ' · parada' : ''}</Badge>;
}

/** Lista de oportunidades com filtros (busca, etapa, situação, responsável, paradas). `entityId` restringe à entidade. */
export function OpportunitiesTable({ entityId, compact }: { entityId?: string; compact?: boolean }) {
  const router = useRouter();
  const { data: assignees } = useAssignees();
  const pipelines = usePipelines();
  const [f, setF] = useState({ q: '', status: '', stageId: '', ownerUserId: '', stalled: false, page: 1 });
  const query = { entityId, q: f.q || undefined, status: f.status || undefined, stageId: f.stageId || undefined, ownerUserId: f.ownerUserId || undefined, stalled: f.stalled ? 'true' : undefined, page: f.page, pageSize: compact ? 10 : 25 };
  const { data } = useQuery({ queryKey: ['opportunities', query], queryFn: () => api<Paginated<OpportunityRow>>('/comercial/opportunities', { query }) });
  const stages = pipelines?.[0]?.stages ?? [];
  return (
    <div>
      {!compact && (
        <div className="row" style={{ marginBottom: 10 }}>
          <Input placeholder="Buscar título, entidade ou município" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value, page: 1 })} style={{ minWidth: 260 }} />
          <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })}><option value="">Todas as situações</option><option value="OPEN">Em andamento</option><option value="WON">Ganhas</option><option value="LOST">Perdidas</option></Select>
          <Select value={f.stageId} onChange={(e) => setF({ ...f, stageId: e.target.value, page: 1 })}><option value="">Todas as etapas</option>{stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          <Select value={f.ownerUserId} onChange={(e) => setF({ ...f, ownerUserId: e.target.value, page: 1 })}><option value="">Todos os responsáveis</option>{assignees?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}<option value="unassigned">Sem responsável</option></Select>
          <label className="row small" style={{ gap: 4 }}><input type="checkbox" checked={f.stalled} onChange={(e) => setF({ ...f, stalled: e.target.checked, page: 1 })} /> Só paradas</label>
        </div>
      )}
      <div className="card">
        {!data ? <div className="bd small muted">Carregando…</div> : data.items.length === 0 ? <div className="bd"><Empty>Nenhuma oportunidade</Empty></div> : (
          <div className="tbl"><Table>
            <thead><tr><Th>Oportunidade</Th>{!entityId && <Th>Entidade</Th>}<Th>Etapa</Th><Th className="r">Valor</Th><Th className="r hide-m">Prob.</Th><Th className="hide-m">Fechamento</Th><Th className="hide-m">Responsável</Th><Th className="hide-m">Próxima ação</Th></tr></thead>
            <tbody>
              {data.items.map((o) => (
                <tr key={o.id} className="click" onClick={() => router.push(`/comercial/oportunidades/${o.id}`)}>
                  <Td><span className="link">{o.title}</span><div className="small muted">{o.source ? OPPORTUNITY_SOURCE_LABELS[o.source as OpportunitySource] ?? o.source : ''}{o.proposalCount ? ` · ${o.proposalCount} proposta(s)` : ''}</div></Td>
                  {!entityId && <Td>{o.entity.shortName ?? o.entity.name}<div className="small muted">{o.entity.municipality}/{o.entity.uf}</div></Td>}
                  <Td><StatusBadge o={o} /><div className="small muted">{o.daysInStage} dia(s)</div></Td>
                  <Td className="r num">{o.totalAmount ? formatBRL(o.totalAmount) : '—'}{o.monthlyAmount && <div className="small muted">{formatBRL(o.monthlyAmount)}/mês</div>}</Td>
                  <Td className="r num hide-m">{o.effectiveProbability}%</Td>
                  <Td className="hide-m">{o.expectedCloseDate ? formatBrDate(o.expectedCloseDate) : '—'}</Td>
                  <Td className="hide-m">{o.owner?.name ?? '—'}</Td>
                  <Td className="hide-m small">{o.nextTask ? `${formatBrDate(o.nextTask.dueDate)} · ${o.nextTask.title}` : <span className="muted">—</span>}</Td>
                </tr>
              ))}
            </tbody>
          </Table></div>
        )}
        {data && data.total > data.pageSize && <div className="bd"><Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setF({ ...f, page: p })} /></div>}
      </div>
    </div>
  );
}
