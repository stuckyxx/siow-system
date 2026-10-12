'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { TASK_PRIORITY_LABELS, TICKET_CHANNELS, TICKET_CHANNEL_LABELS, TICKET_TYPES, TICKET_TYPE_LABELS, toBrDateTimeInput, type TicketRow } from '@siow/shared';
import { api } from '@/lib/api';
import { useAssignees } from '@/components/panels/tasks-panel';
import { Button, Dialog, Field, Input, Select, Textarea } from '@/components/ui';
export { errMsg } from '@/components/crm/opportunity-form';
import { errMsg } from '@/components/crm/opportunity-form';

interface ContactLite { id: string; name: string; role: string | null; phone: string | null; whatsapp: string | null; email: string | null }

/** Abrir/editar chamado. `entityId` fixa a entidade (aba da ficha). */
export function TicketForm({ ticket, entityId, onClose, onSaved }: { ticket?: TicketRow; entityId?: string; onClose: () => void; onSaved: (t: TicketRow) => void }) {
  const editing = Boolean(ticket);
  const { data: assignees } = useAssignees();
  const [f, setF] = useState({ entityId: ticket?.entity?.id ?? entityId ?? '', contactId: ticket?.contact?.id ?? '', type: ticket?.type ?? 'REQUEST', channel: ticket?.channel ?? 'WHATSAPP', priority: ticket?.priority ?? 'MEDIUM', subject: ticket?.subject ?? '', description: ticket?.description ?? '', requesterName: ticket?.requesterName ?? '', assigneeUserId: ticket?.assignee?.id ?? '', openedAt: ticket ? toBrDateTimeInput(ticket.openedAt) : toBrDateTimeInput(new Date()) });
  const [error, setError] = useState<string | null>(null);
  const { data: entities } = useQuery({ queryKey: ['entities-lite'], queryFn: () => api<{ entities: Array<{ id: string; name: string; shortName: string | null }> }>('/financeiro/dashboard/filter-options'), enabled: !entityId && !editing });
  const { data: contacts } = useQuery({ queryKey: ['contacts', f.entityId], queryFn: () => api<ContactLite[]>(`/financeiro/entities/${f.entityId}/contacts`), enabled: Boolean(f.entityId) });
  const b = (k: keyof typeof f) => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }) });
  const m = useMutation({
    mutationFn: () => { const body = { entityId: f.entityId || null, contactId: f.contactId || null, type: f.type, channel: f.channel, priority: f.priority, subject: f.subject, description: f.description || null, requesterName: f.requesterName || null, assigneeUserId: f.assigneeUserId || null, openedAt: f.openedAt || null }; return editing ? api<TicketRow>(`/atendimento/tickets/${ticket!.id}`, { method: 'PATCH', body }) : api<TicketRow>('/atendimento/tickets', { method: 'POST', body }); },
    onSuccess: onSaved, onError: (e) => setError(errMsg(e)),
  });
  return (
    <Dialog open onClose={onClose} title={editing ? `Editar chamado #${ticket!.number}` : 'Abrir chamado'} wide>
      <div className="grid gap-3 md:grid-cols-2">
        {!entityId && <Field label="Entidade (opcional para demandas internas)"><Select {...b('entityId')} onChange={(e) => setF({ ...f, entityId: e.target.value, contactId: '' })}><option value="">— sem entidade —</option>{(entities?.entities ?? (ticket?.entity ? [ticket.entity] : [])).map((e) => <option key={e.id} value={e.id}>{e.shortName ?? e.name}</option>)}</Select></Field>}
        <Field label="Contato da entidade"><Select {...b('contactId')} disabled={!f.entityId}><option value="">—</option>{contacts?.map((c) => <option key={c.id} value={c.id}>{c.name}{c.role ? ` · ${c.role}` : ''}</option>)}</Select></Field>
        {entityId && <Field label="Solicitante (nome livre)"><Input {...b('requesterName')} /></Field>}
        <Field label="Assunto" className="md:col-span-2"><Input {...b('subject')} placeholder="Ex.: Sistema não gera relatório de empenho" /></Field>
        <Field label="Tipo"><Select {...b('type')}>{TICKET_TYPES.map((t) => <option key={t} value={t}>{TICKET_TYPE_LABELS[t]}</option>)}</Select></Field>
        <Field label="Canal de entrada"><Select {...b('channel')}>{TICKET_CHANNELS.map((c) => <option key={c} value={c}>{TICKET_CHANNEL_LABELS[c]}</option>)}</Select></Field>
        <Field label="Prioridade (define o SLA)"><Select {...b('priority')}>{(['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const).map((p) => <option key={p} value={p}>{TASK_PRIORITY_LABELS[p]}</option>)}</Select></Field>
        <Field label="Responsável"><Select {...b('assigneeUserId')}><option value="">— sem responsável —</option>{assignees?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
        {!entityId && <Field label="Solicitante (nome livre)"><Input {...b('requesterName')} /></Field>}
        <Field label="Abertura"><Input type="datetime-local" {...b('openedAt')} /></Field>
        <Field label="Descrição" className="md:col-span-2"><Textarea rows={4} {...b('description')} /></Field>
      </div>
      {error && <div className="alert crit" style={{ marginTop: 10 }}>{error}</div>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => m.mutate()} disabled={m.isPending || f.subject.trim().length < 3}>{editing ? 'Salvar' : 'Abrir chamado'}</Button></div>
    </Dialog>
  );
}
