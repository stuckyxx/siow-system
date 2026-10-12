'use client';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { TASK_PRIORITY_LABELS, TICKET_STATUSES, TICKET_STATUS_LABELS, TICKET_TYPES, TICKET_TYPE_LABELS, formatBrDateTime, type Paginated, type TaskPriority, type TicketRow, type TicketStatus, type TicketType } from '@siow/shared';
import { api } from '@/lib/api';
import { useAssignees } from '@/components/panels/tasks-panel';
import { Badge, Button, Empty, Input, Pagination, Select, Table, Td, Th } from '@/components/ui';
import { TicketForm } from './ticket-form';

export const STATUS_TONE: Record<string, 'info' | 'warn' | 'good' | 'critical' | 'neutral'> = { OPEN: 'info', IN_PROGRESS: 'warn', WAITING_CLIENT: 'neutral', WAITING_INTERNAL: 'neutral', RESOLVED: 'good', CLOSED: 'good', CANCELLED: 'neutral' };
export const PRIORITY_TONE: Record<string, 'info' | 'warn' | 'good' | 'critical' | 'neutral'> = { LOW: 'neutral', MEDIUM: 'info', HIGH: 'warn', URGENT: 'critical' };
export function TicketStatusBadge({ status }: { status: string }) { return <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{TICKET_STATUS_LABELS[status as TicketStatus] ?? status}</Badge>; }
export function PriorityBadge({ priority }: { priority: string }) { return <Badge tone={PRIORITY_TONE[priority] ?? 'neutral'}>{TASK_PRIORITY_LABELS[priority as TaskPriority] ?? priority}</Badge>; }
const SLA_LABEL: Record<string, string> = { OK: 'no prazo', AT_RISK: 'em risco', BREACHED: 'estourado', MET: 'cumprido', NA: '—' };
const SLA_TONE: Record<string, 'info' | 'warn' | 'good' | 'critical' | 'neutral'> = { OK: 'good', AT_RISK: 'warn', BREACHED: 'critical', MET: 'good', NA: 'neutral' };
export function SlaBadge({ state, label, dueAt }: { state: string; label: string; dueAt: string | null }) {
  if (state === 'NA') return <span className="small muted">{label}: —</span>;
  return <span className="small" title={dueAt ? `prazo ${formatBrDateTime(dueAt)}` : undefined}><Badge tone={SLA_TONE[state]}>{label}: {SLA_LABEL[state]}</Badge></span>;
}

/** Lista de chamados com filtros; `entityId` restringe à entidade (aba da ficha 360º). */
export function TicketsTable({ entityId, compact, preset }: { entityId?: string; compact?: boolean; preset?: Partial<{ assigneeUserId: string; slaBreached: boolean; status: string }> }) {
  const router = useRouter();
  const { data: assignees } = useAssignees();
  const [f, setF] = useState({ q: '', status: preset?.status ?? '', priority: '', type: '', assigneeUserId: preset?.assigneeUserId ?? '', open: true, slaBreached: preset?.slaBreached ?? false, page: 1 });
  const [creating, setCreating] = useState(false);
  const query = { entityId, q: f.q || undefined, status: f.status || undefined, priority: f.priority || undefined, type: f.type || undefined, assigneeUserId: f.assigneeUserId || undefined, open: f.open && !f.status ? 'true' : undefined, slaBreached: f.slaBreached ? 'true' : undefined, page: f.page, pageSize: compact ? 10 : 25 };
  const { data, refetch } = useQuery({ queryKey: ['tickets', query], queryFn: () => api<Paginated<TicketRow>>('/atendimento/tickets', { query }) });
  return (
    <div>
      <div className="grid gap-2" style={{ gridTemplateColumns: compact ? '1fr auto auto' : '2fr 1fr 1fr 1fr 1fr auto', alignItems: 'center', marginBottom: 10 }}>
        <Input placeholder="Buscar nº, assunto, solicitante ou entidade" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value, page: 1 })} />
        {!compact && <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })}><option value="">Em aberto</option>{TICKET_STATUSES.map((s) => <option key={s} value={s}>{TICKET_STATUS_LABELS[s]}</option>)}</Select>}
        {!compact && <Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value, page: 1 })}><option value="">Toda prioridade</option>{(['URGENT', 'HIGH', 'MEDIUM', 'LOW'] as const).map((p) => <option key={p} value={p}>{TASK_PRIORITY_LABELS[p]}</option>)}</Select>}
        {!compact && <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, page: 1 })}><option value="">Todo tipo</option>{TICKET_TYPES.map((t) => <option key={t} value={t}>{TICKET_TYPE_LABELS[t]}</option>)}</Select>}
        {!compact && <Select value={f.assigneeUserId} onChange={(e) => setF({ ...f, assigneeUserId: e.target.value, page: 1 })}><option value="">Todos os responsáveis</option><option value="me">Meus chamados</option><option value="unassigned">Sem responsável</option>{assignees?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>}
        <label className="row small" style={{ gap: 4 }}><input type="checkbox" checked={!f.open} onChange={(e) => setF({ ...f, open: !e.target.checked, page: 1 })} /> Incluir encerrados</label>
        {compact && <Button size="sm" onClick={() => setCreating(true)}>+ Chamado</Button>}
      </div>
      <div className="card">
        {!data ? <div className="bd small muted">Carregando…</div> : data.items.length === 0 ? <div className="bd"><Empty>Nenhum chamado</Empty></div> : (
          <div className="tbl"><Table>
            <thead><tr><Th>#</Th><Th>Assunto</Th>{!entityId && <Th>Entidade</Th>}<Th>Situação</Th><Th>Prioridade</Th><Th className="hide-m">Responsável</Th><Th className="hide-m">SLA</Th><Th className="r">Última atividade</Th></tr></thead>
            <tbody>{data.items.map((t) => (
              <tr key={t.id} className="click" onClick={() => router.push(`/atendimento/chamados/${t.id}`)}>
                <Td className="num">#{t.number}</Td>
                <Td><span className="link">{t.subject}</span><div className="small muted">{TICKET_TYPE_LABELS[t.type as TicketType] ?? t.type}{t.requesterName ? ` · ${t.requesterName}` : ''}{t.contact ? ` · ${t.contact.name}` : ''}</div></Td>
                {!entityId && <Td>{t.entity ? <>{t.entity.shortName ?? t.entity.name}<div className="small muted">{t.entity.municipality}/{t.entity.uf}</div></> : <span className="muted">—</span>}</Td>}
                <Td><TicketStatusBadge status={t.status} /></Td>
                <Td><PriorityBadge priority={t.priority} /></Td>
                <Td className="small hide-m">{t.assignee?.name ?? <span className="muted">sem responsável</span>}</Td>
                <Td className="hide-m"><div className="row" style={{ gap: 4, flexWrap: 'wrap' }}><SlaBadge state={t.responseSla} label="resposta" dueAt={t.firstResponseDueAt} /><SlaBadge state={t.resolutionSla} label="solução" dueAt={t.resolutionDueAt} /></div></Td>
                <Td className="r num small">{formatBrDateTime(t.lastActivityAt)}</Td>
              </tr>))}</tbody>
          </Table></div>
        )}
        {data && data.total > data.pageSize && <div className="bd"><Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setF({ ...f, page: p })} /></div>}
      </div>
      {creating && <TicketForm entityId={entityId} onClose={() => setCreating(false)} onSaved={(t) => { setCreating(false); void refetch(); router.push(`/atendimento/chamados/${t.id}`); }} />}
    </div>
  );
}
