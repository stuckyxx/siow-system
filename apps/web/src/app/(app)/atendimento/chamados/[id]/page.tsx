'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { INTERACTION_KIND_LABELS, TASK_PRIORITY_LABELS, TICKET_CHANNEL_LABELS, TICKET_STATUSES, TICKET_STATUS_LABELS, TICKET_TYPE_LABELS, formatBrDate, formatBrDateTime, toBrDateTimeInput, todayIso, type InteractionKind, type TicketChannel, type TicketDetail, type TicketType } from '@siow/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAssignees } from '@/components/panels/tasks-panel';
import { Badge, Button, Dialog, Empty, Field, Input, Select, Stat, Textarea, useToast } from '@/components/ui';
import { TicketForm, errMsg } from '@/components/atendimento/ticket-form';
import { PriorityBadge, SlaBadge, TicketStatusBadge } from '@/components/atendimento/tickets-table';

const KIND_ICON: Record<string, string> = { NOTE: '📝', REPLY: '✉️', CALL: '📞', EMAIL: '📧', WHATSAPP: '💬', VISIT: '📍', MEETING: '🤝', STATUS: '🔁', ASSIGNMENT: '👤', SYSTEM: '⚙️' };
interface DocRow { id: string; name: string; capturedAt: string; blob: { size: number } }

export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { can, user } = useAuth();
  const [toast, showToast] = useToast();
  const [dialog, setDialog] = useState<'edit' | 'status' | 'assign' | 'task' | null>(null);
  const { data: t } = useQuery({ queryKey: ['ticket', id], queryFn: () => api<TicketDetail>(`/atendimento/tickets/${id}`) });
  const refresh = (): void => { for (const k of ['ticket', 'tickets', 'ticket-stats', 'ticket-docs', 'tasks']) void qc.invalidateQueries({ queryKey: [k] }); };
  const takeIt = useMutation({ mutationFn: () => api(`/atendimento/tickets/${id}/assign`, { method: 'POST', body: { assigneeUserId: user?.id ?? null } }), onSuccess: refresh, onError: (e) => showToast(errMsg(e)) });
  const del = useMutation({ mutationFn: () => api(`/atendimento/tickets/${id}`, { method: 'DELETE' }), onSuccess: () => router.push('/atendimento'), onError: (e) => showToast(errMsg(e)) });
  if (!t) return <div className="muted">Carregando…</div>;
  const write = can('tickets.write');
  const open = ['OPEN', 'IN_PROGRESS', 'WAITING_CLIENT', 'WAITING_INTERNAL'].includes(t.status);
  return (
    <div>
      <Link href="/atendimento" className="btn sm" style={{ marginBottom: 10 }}>← Atendimento</Link>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="small muted">{t.entity ? <><Link href={`/financeiro/entidades/${t.entity.id}?tab=atendimento`}>{t.entity.name}</Link> · {t.entity.municipality}/{t.entity.uf}</> : 'Demanda interna (sem entidade)'}{t.contact ? ` · contato ${t.contact.name}` : ''}{t.requesterName ? ` · solicitante ${t.requesterName}` : ''}</div>
          <h1>#{t.number} · {t.subject}</h1>
          <div className="row small muted" style={{ flexWrap: 'wrap' }}><TicketStatusBadge status={t.status} /><PriorityBadge priority={t.priority} /><span>{TICKET_TYPE_LABELS[t.type as TicketType] ?? t.type}</span><span>· via {TICKET_CHANNEL_LABELS[t.channel as TicketChannel] ?? t.channel}</span><span>· aberto {formatBrDateTime(t.openedAt)}</span>{t.assignee ? <span>· responsável <b>{t.assignee.name}</b></span> : <Badge tone="warn">sem responsável</Badge>}{t.contractId && <Link href={`/financeiro/contratos/${t.contractId}`}>· contrato</Link>}{t.opportunityId && <Link href={`/comercial/oportunidades/${t.opportunityId}`}>· oportunidade</Link>}{t.tenderId && <Link href={`/licitacoes/${t.tenderId}`}>· licitação</Link>}</div>
          {t.description && <p className="small" style={{ margin: '6px 0 0', color: 'var(--ink2)', maxWidth: 860, whiteSpace: 'pre-wrap' }}>{t.description}</p>}
        </div>
        <div className="row" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {write && open && !t.assignee && <Button variant="secondary" onClick={() => takeIt.mutate()} disabled={takeIt.isPending}>Assumir</Button>}
          {write && <Button variant="secondary" onClick={() => setDialog('assign')}>Atribuir</Button>}
          {write && <Button variant="secondary" onClick={() => setDialog('edit')}>Editar</Button>}
          {write && can('tasks.manage') && <Button variant="secondary" onClick={() => setDialog('task')}>+ Tarefa</Button>}
          {write && <Button onClick={() => setDialog('status')}>{open ? 'Resolver / mudar situação' : 'Reabrir / mudar situação'}</Button>}
          {can('tickets.manage') && <Button variant="ghost" onClick={() => { if (confirm('Excluir este chamado?')) del.mutate(); }}>Excluir</Button>}
        </div>
      </div>
      <div className="g4" style={{ marginTop: 12 }}>
        <Stat small label="SLA 1ª resposta" value={<SlaBadge state={t.responseSla} label="resposta" dueAt={t.firstResponseDueAt} />} hint={t.firstResponseAt ? `respondido ${formatBrDateTime(t.firstResponseAt)}` : t.firstResponseDueAt ? `até ${formatBrDateTime(t.firstResponseDueAt)}` : undefined} />
        <Stat small label="SLA solução" value={<SlaBadge state={t.resolutionSla} label="solução" dueAt={t.resolutionDueAt} />} hint={t.resolvedAt ? `resolvido ${formatBrDateTime(t.resolvedAt)}` : t.resolutionDueAt ? `até ${formatBrDateTime(t.resolutionDueAt)}` : undefined} />
        <Stat small label="Interações" value={t.interactionsCount} hint={`última atividade ${formatBrDateTime(t.lastActivityAt)}`} />
        <Stat small label="Satisfação" value={t.satisfactionScore != null ? `${'★'.repeat(t.satisfactionScore)}${'☆'.repeat(5 - t.satisfactionScore)}` : '—'} hint={t.satisfactionComment ?? (t.satisfactionUrl ? 'link de avaliação disponível' : 'gerado ao resolver')} tone={t.satisfactionScore != null ? (t.satisfactionScore >= 4 ? 'good' : t.satisfactionScore <= 2 ? 'critical' : 'warn') : undefined} />
      </div>
      {t.resolutionNotes && <div className="alert good" style={{ marginTop: 8 }}><b>Solução:</b> {t.resolutionNotes}</div>}
      {t.satisfactionUrl && t.satisfactionScore == null && <div className="alert" style={{ marginTop: 8 }}>Link de avaliação para o cliente: <code style={{ userSelect: 'all' }}>{t.satisfactionUrl}</code> <Button size="sm" variant="secondary" onClick={() => { void navigator.clipboard?.writeText(t.satisfactionUrl!); showToast('Link copiado'); }}>Copiar</Button></div>}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', marginTop: 14 }}>
        <div>
          {write && <Composer t={t} onDone={(r) => { refresh(); if (r.manualLink) window.open(r.manualLink, '_blank', 'noopener'); showToast(r.sent === true ? 'Enviado ao cliente' : r.sent === false ? 'Registrado para envio manual' : 'Interação registrada'); }} onError={showToast} />}
          <div className="card" style={{ marginTop: 10 }}><div className="bd">
            <h3 style={{ margin: '0 0 8px' }}>Histórico de interações</h3>
            {t.interactions.length === 0 ? <Empty>Sem interações</Empty> : <ul className="hist">{t.interactions.map((i) => (
              <li key={i.id}><div className="row between" style={{ alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}><b>{KIND_ICON[i.kind] ?? ''} {INTERACTION_KIND_LABELS[i.kind as InteractionKind] ?? i.kind}</b>{i.direction !== 'INTERNAL' && <Badge tone={i.direction === 'OUTBOUND' ? 'info' : 'warn'} className="ml-2">{i.direction === 'OUTBOUND' ? 'ao cliente' : 'do cliente'}</Badge>}{i.contactName && <span className="small muted"> · {i.contactName}</span>}
                  <div className="small" style={{ whiteSpace: 'pre-wrap', color: 'var(--ink2)' }}>{i.body}</div>
                  {(i.durationMinutes || i.location || i.attendees) && <div className="small muted">{[i.durationMinutes ? `${i.durationMinutes} min` : null, i.location, i.attendees ? `participantes: ${i.attendees}` : null].filter(Boolean).join(' · ')}</div>}
                </div>
                <span className="small muted" style={{ whiteSpace: 'nowrap' }}>{formatBrDateTime(i.occurredAt)}{i.userName ? ` · ${i.userName}` : ''}</span>
              </div></li>))}</ul>}
          </div></div>
        </div>
        <div>
          <div className="card"><div className="bd"><div className="row between"><h3 style={{ margin: 0 }}>Tarefas de acompanhamento</h3></div>
            {t.tasks.length === 0 ? <p className="small muted" style={{ margin: '6px 0 0' }}>Nenhuma tarefa</p> : <ul className="hist">{t.tasks.map((k) => <li key={k.id} className="row between small"><span style={{ textDecoration: k.status === 'DONE' ? 'line-through' : undefined }}><Link href={`/financeiro/agenda`}>{k.title}</Link>{k.assigneeName ? <span className="muted"> · {k.assigneeName}</span> : null}</span><span className="muted">{formatBrDate(k.dueDate)}</span></li>)}</ul>}
          </div></div>
          <Documents t={t} write={write} onError={showToast} />
          {t.contact && <div className="card" style={{ marginTop: 10 }}><div className="bd small"><h3 style={{ margin: '0 0 6px' }}>Contato</h3><b>{t.contact.name}</b>{t.contact.whatsapp || t.contact.phone ? <div>📱 {t.contact.whatsapp ?? t.contact.phone}</div> : null}{t.contact.email ? <div>📧 {t.contact.email}</div> : null}</div></div>}
        </div>
      </div>
      {dialog === 'edit' && <TicketForm ticket={t} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); refresh(); }} />}
      {dialog === 'status' && <StatusDialog t={t} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); }} />}
      {dialog === 'assign' && <AssignDialog t={t} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); }} />}
      {dialog === 'task' && <TaskDialog t={t} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); showToast('Tarefa criada na agenda'); }} />}
      {toast}
    </div>
  );
}

function Composer({ t, onDone, onError }: { t: TicketDetail; onDone: (r: { manualLink: string | null; sent: boolean | null }) => void; onError: (m: string) => void }) {
  const [f, setF] = useState({ kind: 'NOTE', body: '', occurredAt: toBrDateTimeInput(new Date()), durationMinutes: '', location: '', attendees: '', sendVia: '' });
  const m = useMutation({ mutationFn: () => api<{ manualLink: string | null; sent: boolean | null }>(`/atendimento/tickets/${t.id}/interactions`, { method: 'POST', body: { kind: f.kind, body: f.body, occurredAt: f.occurredAt || null, durationMinutes: f.durationMinutes ? Number(f.durationMinutes) : null, location: f.location || null, attendees: f.attendees || null, sendVia: f.sendVia || null } }), onSuccess: (r) => { setF({ ...f, body: '', durationMinutes: '', location: '', attendees: '', sendVia: '' }); onDone(r); }, onError: (e) => onError(errMsg(e)) });
  const canSend = Boolean(t.entity && t.contact);
  const extra = f.kind === 'VISIT' || f.kind === 'MEETING' || f.kind === 'CALL';
  return (
    <div className="card"><div className="bd">
      <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
        <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value, sendVia: '' })}>{(['NOTE', 'REPLY', 'CALL', 'EMAIL', 'WHATSAPP', 'VISIT', 'MEETING'] as const).map((k) => <option key={k} value={k}>{INTERACTION_KIND_LABELS[k]}</option>)}</Select>
        <Input type="datetime-local" value={f.occurredAt} onChange={(e) => setF({ ...f, occurredAt: e.target.value })} />
        {f.kind === 'REPLY' ? <Select value={f.sendVia} onChange={(e) => setF({ ...f, sendVia: e.target.value })} disabled={!canSend} title={canSend ? '' : 'Chamado sem entidade/contato'}><option value="">Só registrar</option><option value="WHATSAPP">Enviar por WhatsApp</option><option value="EMAIL">Enviar por e-mail</option></Select> : extra ? <Input placeholder="Duração (min)" value={f.durationMinutes} onChange={(e) => setF({ ...f, durationMinutes: e.target.value })} /> : <span />}
      </div>
      {(f.kind === 'VISIT' || f.kind === 'MEETING') && <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 8 }}><Input placeholder="Local" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /><Input placeholder="Participantes" value={f.attendees} onChange={(e) => setF({ ...f, attendees: e.target.value })} /></div>}
      <Textarea rows={3} style={{ marginTop: 8 }} placeholder={f.kind === 'MEETING' ? 'Ata da reunião: pauta, decisões, encaminhamentos…' : f.kind === 'VISIT' ? 'Relato da visita…' : f.kind === 'REPLY' ? 'Resposta ao cliente…' : 'Nota interna…'} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
      <div className="row between" style={{ marginTop: 8 }}><span className="small muted">{f.kind === 'REPLY' || f.sendVia ? 'Conta como 1ª resposta ao cliente (SLA).' : f.kind === 'NOTE' ? 'Nota interna: não aparece para o cliente.' : 'Registro de contato recebido/realizado.'}</span><Button size="sm" onClick={() => m.mutate()} disabled={m.isPending || !f.body.trim()}>{f.sendVia ? 'Registrar e enviar' : 'Registrar'}</Button></div>
    </div></div>
  );
}

function StatusDialog({ t, onClose, onDone }: { t: TicketDetail; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ status: t.status === 'OPEN' || t.status === 'IN_PROGRESS' ? 'RESOLVED' : t.status, notes: '', resolutionNotes: t.resolutionNotes ?? '' });
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({ mutationFn: () => api(`/atendimento/tickets/${t.id}/status`, { method: 'POST', body: { status: f.status, notes: f.notes || null, resolutionNotes: f.resolutionNotes || null } }), onSuccess: onDone, onError: (e) => setError(errMsg(e)) });
  return (
    <Dialog open onClose={onClose} title={`Situação do chamado #${t.number}`}>
      <div className="grid gap-3">
        <Field label="Nova situação"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{TICKET_STATUSES.map((s) => <option key={s} value={s}>{TICKET_STATUS_LABELS[s]}</option>)}</Select></Field>
        {(f.status === 'RESOLVED' || f.status === 'CLOSED') && <Field label="Solução aplicada"><Textarea rows={3} value={f.resolutionNotes} onChange={(e) => setF({ ...f, resolutionNotes: e.target.value })} /></Field>}
        <Field label="Observações"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      {f.status === 'RESOLVED' && <p className="small muted">Ao resolver, o sistema gera um link de avaliação (1 a 5) para enviar ao cliente.</p>}
      {error && <div className="alert crit" style={{ marginTop: 10 }}>{error}</div>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => m.mutate()} disabled={m.isPending}>Salvar</Button></div>
    </Dialog>
  );
}

function AssignDialog({ t, onClose, onDone }: { t: TicketDetail; onClose: () => void; onDone: () => void }) {
  const { data: assignees } = useAssignees();
  const [f, setF] = useState({ assigneeUserId: t.assignee?.id ?? '', notes: '' });
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({ mutationFn: () => api(`/atendimento/tickets/${t.id}/assign`, { method: 'POST', body: { assigneeUserId: f.assigneeUserId || null, notes: f.notes || null } }), onSuccess: onDone, onError: (e) => setError(errMsg(e)) });
  return (
    <Dialog open onClose={onClose} title="Atribuir responsável">
      <div className="grid gap-3"><Field label="Responsável"><Select value={f.assigneeUserId} onChange={(e) => setF({ ...f, assigneeUserId: e.target.value })}><option value="">— sem responsável —</option>{assignees?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field><Field label="Observação"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field></div>
      {error && <div className="alert crit" style={{ marginTop: 10 }}>{error}</div>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => m.mutate()} disabled={m.isPending}>Salvar</Button></div>
    </Dialog>
  );
}

function TaskDialog({ t, onClose, onDone }: { t: TicketDetail; onClose: () => void; onDone: () => void }) {
  const { data: assignees } = useAssignees();
  const [f, setF] = useState({ title: `Acompanhar chamado #${t.number}: ${t.subject}`.slice(0, 200), dueDate: todayIso(), dueTime: '', assigneeUserId: t.assignee?.id ?? '', priority: t.priority, notes: '' });
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({ mutationFn: () => api(`/atendimento/tickets/${t.id}/tasks`, { method: 'POST', body: { title: f.title, dueDate: f.dueDate, dueTime: f.dueTime || null, assigneeUserId: f.assigneeUserId || null, priority: f.priority, notes: f.notes || null } }), onSuccess: onDone, onError: (e) => setError(errMsg(e)) });
  return (
    <Dialog open onClose={onClose} title="Tarefa de acompanhamento">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Título" className="md:col-span-2"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Data"><Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
        <Field label="Hora"><Input type="time" value={f.dueTime} onChange={(e) => setF({ ...f, dueTime: e.target.value })} /></Field>
        <Field label="Responsável"><Select value={f.assigneeUserId} onChange={(e) => setF({ ...f, assigneeUserId: e.target.value })}><option value="">—</option>{assignees?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
        <Field label="Prioridade"><Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{(['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const).map((p) => <option key={p} value={p}>{TASK_PRIORITY_LABELS[p]}</option>)}</Select></Field>
        <Field label="Observações" className="md:col-span-2"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      {error && <div className="alert crit" style={{ marginTop: 10 }}>{error}</div>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => m.mutate()} disabled={m.isPending || !f.title}>Criar tarefa</Button></div>
    </Dialog>
  );
}

function Documents({ t, write, onError }: { t: TicketDetail; write: boolean; onError: (m: string) => void }) {
  const qc = useQueryClient();
  const ref = useRef<HTMLInputElement>(null);
  const { data } = useQuery({ queryKey: ['ticket-docs', t.id], queryFn: () => api<DocRow[]>(`/atendimento/tickets/${t.id}/documents`) });
  const upload = useMutation({ mutationFn: (file: File) => { const fd = new FormData(); fd.append('file', file); fd.append('name', file.name); return api(`/atendimento/tickets/${t.id}/documents`, { method: 'POST', formData: fd }); }, onSuccess: () => { void qc.invalidateQueries({ queryKey: ['ticket-docs', t.id] }); void qc.invalidateQueries({ queryKey: ['ticket', t.id] }); }, onError: (e) => onError(errMsg(e)) });
  const open = async (id: string): Promise<void> => { const r = await api<{ url: string }>(`/documents/${id}/download-url`); window.open(r.url, '_blank', 'noopener'); };
  return (
    <div className="card" style={{ marginTop: 10 }}><div className="bd">
      <div className="row between"><h3 style={{ margin: 0 }}>Anexos</h3>{write && <><input ref={ref} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} /><Button size="sm" variant="secondary" onClick={() => ref.current?.click()} disabled={upload.isPending}>{upload.isPending ? 'Enviando…' : 'Anexar'}</Button></>}</div>
      {!data ? <p className="small muted">Carregando…</p> : data.length === 0 ? <p className="small muted" style={{ margin: '6px 0 0' }}>Nenhum anexo</p> : <ul className="hist">{data.map((d) => <li key={d.id} className="row between small"><span>📄 {d.name} <span className="muted">· {Math.max(1, Math.round(d.blob.size / 1024))} KB</span></span><Button size="sm" variant="ghost" onClick={() => void open(d.id).catch((e) => onError(errMsg(e)))}>Abrir</Button></li>)}</ul>}
    </div></div>
  );
}
