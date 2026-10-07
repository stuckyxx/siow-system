'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { TASK_PRIORITIES, TASK_PRIORITY_LABELS, TASK_STATUSES, TASK_STATUS_LABELS, TASK_TYPES, TASK_TYPE_LABELS, formatBrDate, todayIso, type Paginated, type TaskPriority, type TaskStatus, type TaskType } from '@siow/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { TaskStatusBadge } from '../status';
import { Badge, Button, Card, Dialog, Empty, Field, Input, Select, Table, Td, Th, Textarea } from '../ui';

export interface TaskRow {
  id: string; title: string; description: string | null; type: TaskType; priority: TaskPriority; status: TaskStatus; dueDate: string; dueTime: string | null; notes: string | null;
  entity: { id: string; name: string; shortName: string | null } | null; assignee: { id: string; name: string } | null; invoice: { number: string } | null;
}

export function useAssignees() {
  return useQuery({ queryKey: ['assignees'], queryFn: () => api<Array<{ id: string; name: string }>>('/users/assignees'), staleTime: 5 * 60_000 });
}

/** Agenda financeira — geral (spec §14/15) ou por entidade (§16). */
export function TasksPanel({ entityId, compact, autoCreate }: { entityId?: string; compact?: boolean; autoCreate?: boolean }) {
  const { can, user } = useAuth();
  const qc = useQueryClient();
  const { data: assignees } = useAssignees();
  const [assignee, setAssignee] = useState<string>('');
  const [status, setStatus] = useState<string>(compact ? 'PENDING' : '');
  const [creating, setCreating] = useState(Boolean(autoCreate));
  const [editing, setEditing] = useState<TaskRow | null>(null);
  const query = { entityId, assigneeUserId: assignee || undefined, status: status || undefined, pageSize: compact ? 8 : 100, sortDir: 'asc' as const };
  const { data } = useQuery({ queryKey: ['tasks', query], queryFn: () => api<Paginated<TaskRow>>('/financeiro/tasks', { query }) });
  const update = useMutation({ mutationFn: (v: { id: string; status: TaskStatus }) => api(`/financeiro/tasks/${v.id}`, { method: 'PATCH', body: { status: v.status } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }) });
  const today = todayIso();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {!compact && (
          <>
            <Select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="w-48"><option value="">Toda a equipe</option><option value={user?.id}>Minha agenda</option>{assignees?.filter((a) => a.id !== user?.id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}<option value="unassigned">Sem responsável</option></Select>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40"><option value="">Todas as situações</option>{TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>)}</Select>
          </>
        )}
        {can('tasks.manage') && <Button size={compact ? 'sm' : 'md'} className="ml-auto" onClick={() => setCreating(true)}>Nova tarefa</Button>}
      </div>
      <Card>
        {!data ? <div className="p-4 text-sm text-ink-3">Carregando…</div> : data.items.length === 0 ? <div className="p-4"><Empty>Nenhuma tarefa</Empty></div> : (
          <Table>
            <thead><tr><Th>Data</Th><Th>Tarefa</Th>{!entityId && <Th>Entidade</Th>}<Th>Responsável</Th><Th>Prioridade</Th><Th>Situação</Th><Th></Th></tr></thead>
            <tbody>
              {data.items.map((t) => (
                <tr key={t.id} className="hover:bg-surface">
                  <Td className={`tabular-nums ${t.dueDate.slice(0, 10) < today && (t.status === 'PENDING' || t.status === 'IN_PROGRESS') ? 'text-critical' : ''}`}>{formatBrDate(t.dueDate)}{t.dueTime && <span className="text-ink-3"> {t.dueTime}</span>}</Td>
                  <Td><button className="text-left hover:underline" onClick={() => setEditing(t)}>{t.title}</button><div className="text-xs text-ink-3">{TASK_TYPE_LABELS[t.type]}{t.invoice ? ` · NF ${t.invoice.number}` : ''}</div></Td>
                  {!entityId && <Td className="text-ink-2">{t.entity?.shortName ?? t.entity?.name ?? '—'}</Td>}
                  <Td className="text-ink-2">{t.assignee?.name ?? <span className="text-ink-3">—</span>}</Td>
                  <Td><Badge tone={t.priority === 'URGENT' ? 'critical' : t.priority === 'HIGH' ? 'serious' : t.priority === 'MEDIUM' ? 'neutral' : 'neutral'}>{TASK_PRIORITY_LABELS[t.priority]}</Badge></Td>
                  <Td><TaskStatusBadge status={t.status} /></Td>
                  <Td className="whitespace-nowrap">{can('tasks.manage') && t.status !== 'DONE' && t.status !== 'CANCELLED' && <><Button size="sm" variant="ghost" onClick={() => update.mutate({ id: t.id, status: 'IN_PROGRESS' })}>Iniciar</Button><Button size="sm" variant="ghost" onClick={() => update.mutate({ id: t.id, status: 'DONE' })}>Concluir</Button></>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <TaskForm open={creating || Boolean(editing)} task={editing} entityId={entityId} onClose={() => { setCreating(false); setEditing(null); }} onSaved={() => { setCreating(false); setEditing(null); qc.invalidateQueries({ queryKey: ['tasks'] }); }} />
    </div>
  );
}

function TaskForm({ open, task, entityId, onClose, onSaved }: { open: boolean; task: TaskRow | null; entityId?: string; onClose: () => void; onSaved: () => void }) {
  const { data: assignees } = useAssignees();
  const { data: entities } = useQuery({ queryKey: ['entities-lite'], queryFn: () => api<{ entities: Array<{ id: string; name: string; shortName: string | null }> }>('/financeiro/dashboard/filter-options'), enabled: !entityId });
  const init = { title: task?.title ?? '', type: task?.type ?? 'CUSTOM', description: task?.description ?? '', entityId: task?.entity?.id ?? entityId ?? '', assigneeUserId: task?.assignee?.id ?? '', priority: task?.priority ?? 'MEDIUM', dueDate: task?.dueDate.slice(0, 10) ?? todayIso(), dueTime: task?.dueTime ?? '', status: task?.status ?? 'PENDING', notes: task?.notes ?? '' };
  const [f, setF] = useState(init);
  const [key, setKey] = useState<string | null>(null);
  if (open && key !== (task?.id ?? 'new')) { setKey(task?.id ?? 'new'); setF(init); }
  const m = useMutation({
    mutationFn: () => {
      const body = { ...f, entityId: f.entityId || null, assigneeUserId: f.assigneeUserId || null, description: f.description || null, dueTime: f.dueTime || null, notes: f.notes || null, title: f.title || TASK_TYPE_LABELS[f.type as TaskType] };
      return task ? api(`/financeiro/tasks/${task.id}`, { method: 'PATCH', body }) : api('/financeiro/tasks', { method: 'POST', body: { ...body, status: undefined } });
    },
    onSuccess: onSaved,
  });
  const b = (k: keyof typeof f) => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }) });
  return (
    <Dialog open={open} onClose={onClose} title={task ? 'Editar tarefa' : 'Nova tarefa'}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Tipo"><Select {...b('type')}>{TASK_TYPES.map((t) => <option key={t} value={t}>{TASK_TYPE_LABELS[t]}</option>)}</Select></Field>
        <Field label="Título"><Input {...b('title')} placeholder={TASK_TYPE_LABELS[f.type as TaskType]} /></Field>
        {!entityId && <Field label="Entidade"><Select {...b('entityId')}><option value="">—</option>{entities?.entities.map((e) => <option key={e.id} value={e.id}>{e.shortName ?? e.name}</option>)}</Select></Field>}
        <Field label="Responsável"><Select {...b('assigneeUserId')}><option value="">—</option>{assignees?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
        <Field label="Data"><Input type="date" {...b('dueDate')} /></Field>
        <Field label="Horário (opcional)"><Input type="time" {...b('dueTime')} /></Field>
        <Field label="Prioridade"><Select {...b('priority')}>{TASK_PRIORITIES.map((p) => <option key={p} value={p}>{TASK_PRIORITY_LABELS[p]}</option>)}</Select></Field>
        {task && <Field label="Situação"><Select {...b('status')}>{TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>)}</Select></Field>}
        <Field label="Descrição" className="md:col-span-2"><Textarea rows={2} {...b('description')} /></Field>
        <Field label="Observações" className="md:col-span-2"><Textarea rows={2} {...b('notes')} /></Field>
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => m.mutate()} disabled={m.isPending}>Salvar</Button></div>
    </Dialog>
  );
}
