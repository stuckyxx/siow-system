'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { AskAssistantButton } from '@/components/assistant/assistant-chat';
import { useAssignees } from '@/components/panels/tasks-panel';
import { Badge, Button, Dialog, Empty, Field, Input, Select, Textarea, useToast } from '@/components/ui';
import { errMsg } from '@/components/crm/opportunity-form';

interface Conv { id: string; waId: string; displayName: string | null; contact: { id: string; name: string } | null; entity: { id: string; name: string; shortName: string | null } | null; ticketId: string | null; ticketNumber: number | null; status: string; assignee: { id: string; name: string } | null; unreadCount: number; lastInboundAt: string | null; lastOutboundAt: string | null; lastMessageAt: string; lastMessagePreview: string | null; windowOpen: boolean; windowExpiresAt: string | null }
interface Msg { id: string; direction: string; type: string; body: string | null; mediaMimeType: string | null; mediaFileName: string | null; documentId: string | null; status: string; error: string | null; userName: string | null; templateName: string | null; timestamp: string }
interface Detail extends Conv { messages: Msg[] }
interface Tpl { name: string; language: string; category: string; body: string; paramCount: number }
interface Stats { open: number; unassigned: number; mine: number; unread: number; waitingReply: number }

const fmtPhone = (w: string): string => (w.length === 13 ? `+${w.slice(0, 2)} (${w.slice(2, 4)}) ${w.slice(4, 9)}-${w.slice(9)}` : w.length === 12 ? `+${w.slice(0, 2)} (${w.slice(2, 4)}) ${w.slice(4, 8)}-${w.slice(8)}` : w);
const STATUS_ICON: Record<string, string> = { QUEUED: '🕓', SENT: '✓', DELIVERED: '✓✓', READ: '✓✓', FAILED: '✖', RECEIVED: '' };
const hhmm = (iso: string): string => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

export default function WhatsAppInbox() {
  const qc = useQueryClient();
  const { can, user } = useAuth();
  const [toast, showToast] = useToast();
  const [filter, setFilter] = useState<'all' | 'mine' | 'unassigned' | 'unread' | 'closed'>('all');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const { data: stats } = useQuery({ queryKey: ['wa-stats'], queryFn: () => api<Stats>('/atendimento/whatsapp/stats'), refetchInterval: 10_000 });
  const { data: list } = useQuery({ queryKey: ['wa-conversations', filter, q], queryFn: () => api<Conv[]>('/atendimento/whatsapp/conversations', { query: { filter, q: q || undefined } }), refetchInterval: 5_000 });
  const refresh = (): void => { for (const k of ['wa-stats', 'wa-conversations', 'wa-conversation', 'tickets', 'ticket-stats']) void qc.invalidateQueries({ queryKey: [k] }); };
  return (
    <div>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div><Link href="/atendimento" className="btn sm" style={{ marginBottom: 8 }}>← Atendimento</Link><h1>Central WhatsApp</h1><p className="sub">Conversas do número da empresa: fila por atendente, janela de 24h, modelos aprovados e chamados vinculados. Atualiza sozinha a cada 5 segundos.</p></div>
        <div className="row">{stats && <span className="small muted">{stats.open} abertas · {stats.unassigned} sem atendente · {stats.waitingReply} aguardando resposta · {stats.unread} não lidas</span>}{can('tickets.write') && <Button variant="secondary" onClick={() => setStarting(true)}>+ Nova conversa</Button>}</div>
      </div>
      <div className="wa-wrap">
        <aside className="wa-list">
          <div className="seg" style={{ margin: '0 0 8px', flexWrap: 'wrap' }}>{([['all', 'Todas'], ['mine', 'Minhas'], ['unassigned', 'Sem atendente'], ['unread', 'Não lidas'], ['closed', 'Encerradas']] as const).map(([k, l]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}{k === 'mine' && stats?.mine ? ` (${stats.mine})` : k === 'unassigned' && stats?.unassigned ? ` (${stats.unassigned})` : ''}</button>)}</div>
          <Input placeholder="Buscar número, nome ou entidade" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 8 }} />
          {!list ? <div className="small muted">Carregando…</div> : list.length === 0 ? <Empty>Nenhuma conversa</Empty> : list.map((c) => (
            <button key={c.id} className={`wa-item ${sel === c.id ? 'on' : ''}`} onClick={() => setSel(c.id)}>
              <div className="row between"><b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.contact?.name ?? c.displayName ?? fmtPhone(c.waId)}</b><span className="small muted">{hhmm(c.lastMessageAt)}</span></div>
              <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.entity ? (c.entity.shortName ?? c.entity.name) : fmtPhone(c.waId)}</div>
              <div className="row between"><span className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ink2)' }}>{c.lastMessagePreview ?? ''}</span>{c.unreadCount > 0 && <Badge tone="good">{c.unreadCount}</Badge>}</div>
              <div className="row small muted" style={{ gap: 6 }}>{c.assignee ? <span>👤 {c.assignee.id === user?.id ? 'você' : c.assignee.name}</span> : <Badge tone="warn">sem atendente</Badge>}{!c.windowOpen && c.status === 'OPEN' && <span title="Fora da janela de 24h: só modelos aprovados">⏱ fora da janela</span>}</div>
            </button>
          ))}
        </aside>
        <section className="wa-thread">{sel ? <Thread id={sel} onChanged={refresh} onToast={showToast} /> : <div className="muted" style={{ padding: 40, textAlign: 'center' }}>Selecione uma conversa</div>}</section>
      </div>
      {starting && <StartDialog onClose={() => setStarting(false)} onStarted={(c) => { setStarting(false); refresh(); setSel(c.id); }} />}
      {toast}
    </div>
  );
}

function Thread({ id, onChanged, onToast }: { id: string; onChanged: () => void; onToast: (m: string) => void }) {
  const qc = useQueryClient();
  const { can, user } = useAuth();
  const { data: assignees } = useAssignees();
  const { data: c } = useQuery({ queryKey: ['wa-conversation', id], queryFn: () => api<Detail>(`/atendimento/whatsapp/conversations/${id}`), refetchInterval: 5_000 });
  const [text, setText] = useState('');
  const [tplOpen, setTplOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);
  useEffect(() => { if (c && c.messages.length !== lastCount.current) { lastCount.current = c.messages.length; endRef.current?.scrollIntoView({ block: 'end' }); } }, [c]);
  useEffect(() => { if (c && c.unreadCount > 0) void api(`/atendimento/whatsapp/conversations/${id}/read`, { method: 'POST' }).then(() => { void qc.invalidateQueries({ queryKey: ['wa-conversations'] }); void qc.invalidateQueries({ queryKey: ['wa-stats'] }); }); }, [c?.unreadCount, id]);
  const invalidate = (): void => { void qc.invalidateQueries({ queryKey: ['wa-conversation', id] }); onChanged(); };
  const send = useMutation({ mutationFn: () => api<Msg>(`/atendimento/whatsapp/conversations/${id}/messages`, { method: 'POST', body: { body: text } }), onSuccess: (m) => { setText(''); invalidate(); if (m.status === 'FAILED') onToast(`Falha no envio: ${m.error ?? ''}`); }, onError: (e) => onToast(errMsg(e)) });
  const assign = useMutation({ mutationFn: (uid: string | null) => api(`/atendimento/whatsapp/conversations/${id}/assign`, { method: 'POST', body: { assigneeUserId: uid } }), onSuccess: invalidate, onError: (e) => onToast(errMsg(e)) });
  const close = useMutation({ mutationFn: () => api(`/atendimento/whatsapp/conversations/${id}/close`, { method: 'POST', body: { resolveTicket: true } }), onSuccess: () => { invalidate(); onToast('Conversa encerrada e chamado resolvido'); }, onError: (e) => onToast(errMsg(e)) });
  const reopen = useMutation({ mutationFn: () => api(`/atendimento/whatsapp/conversations/${id}/reopen`, { method: 'POST' }), onSuccess: invalidate, onError: (e) => onToast(errMsg(e)) });
  const openDoc = async (docId: string): Promise<void> => { const r = await api<{ url: string }>(`/documents/${docId}/download-url`); window.open(r.url, '_blank', 'noopener'); };
  if (!c) return <div className="muted" style={{ padding: 20 }}>Carregando…</div>;
  const write = can('tickets.write');
  return (
    <>
      <header className="wa-head">
        <div><b>{c.contact?.name ?? c.displayName ?? fmtPhone(c.waId)}</b> <span className="small muted">{fmtPhone(c.waId)}</span>
          <div className="small muted">{c.entity ? <Link href={`/financeiro/entidades/${c.entity.id}?tab=atendimento`}>{c.entity.name}</Link> : <button className="link" onClick={() => setLinkOpen(true)}>Número sem contato cadastrado — vincular</button>}{c.ticketId && <> · <Link href={`/atendimento/chamados/${c.ticketId}`}>chamado #{c.ticketNumber}</Link></>}{c.windowOpen ? <> · <Badge tone="good">janela aberta até {c.windowExpiresAt ? hhmm(c.windowExpiresAt) : ''}</Badge></> : <> · <Badge tone="warn">fora da janela de 24h</Badge></>}</div>
        </div>
        <div className="row">
          {write && <Select value={c.assignee?.id ?? ''} onChange={(e) => assign.mutate(e.target.value || null)} style={{ width: 180 }}><option value="">Sem atendente</option>{assignees?.map((a) => <option key={a.id} value={a.id}>{a.id === user?.id ? `${a.name} (você)` : a.name}</option>)}</Select>}
          <AskAssistantButton context={{ kind: 'whatsapp', id, label: `WhatsApp · ${c.contact?.name ?? c.displayName ?? fmtPhone(c.waId)}`, path: '/atendimento/whatsapp' }} suggestions={['Resuma esta conversa e o que o cliente precisa', 'Responda ao cliente que recebemos a solicitação e retornaremos até amanhã', 'Abra uma tarefa para amanhã com o pedido do cliente', 'Encerre a conversa e resolva o chamado']} onChanged={invalidate} />
          {write && !c.assignee && <Button size="sm" variant="secondary" onClick={() => assign.mutate(user?.id ?? null)}>Assumir</Button>}
          {write && c.status === 'OPEN' ? <Button size="sm" variant="secondary" onClick={() => close.mutate()}>Encerrar</Button> : write && <Button size="sm" variant="secondary" onClick={() => reopen.mutate()}>Reabrir</Button>}
        </div>
      </header>
      <div className="wa-msgs">
        {c.messages.map((m) => (
          <div key={m.id} className={`wa-msg ${m.direction === 'OUT' ? 'out' : 'in'}`}>
            {m.templateName && <div className="small muted">modelo: {m.templateName}</div>}
            {m.documentId ? <button className="link" onClick={() => void openDoc(m.documentId!).catch((e) => onToast(errMsg(e)))}>📎 {m.mediaFileName ?? `${m.type} (${m.mediaMimeType ?? ''})`}</button> : m.type !== 'text' && m.type !== 'template' && !m.body ? <span className="muted">[{m.type}{m.mediaMimeType ? ` · ${m.mediaMimeType}` : ''}]</span> : null}
            {m.body && <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>}
            <div className="wa-meta">{m.direction === 'OUT' && m.userName ? `${m.userName} · ` : ''}{hhmm(m.timestamp)} {m.direction === 'OUT' ? <span title={m.status} style={{ color: m.status === 'READ' ? 'var(--accent)' : m.status === 'FAILED' ? 'var(--crit)' : undefined }}>{STATUS_ICON[m.status] ?? ''}</span> : ''}{m.error && <span style={{ color: 'var(--crit)' }}> {m.error}</span>}</div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {write && (
        <footer className="wa-composer">
          {c.windowOpen ? (
            <><Textarea rows={2} placeholder="Escreva a resposta… (Enter envia, Shift+Enter quebra linha)" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (text.trim()) send.mutate(); } }} /><div className="row" style={{ flexDirection: 'column', gap: 4 }}><Button onClick={() => send.mutate()} disabled={send.isPending || !text.trim()}>Enviar</Button><Button size="sm" variant="ghost" onClick={() => setTplOpen(true)}>Modelo</Button></div></>
          ) : (
            <div className="row between" style={{ width: '100%' }}><span className="small muted">O cliente não escreveu nas últimas 24h: a Meta só permite iniciar com um modelo aprovado.</span><Button onClick={() => setTplOpen(true)}>Enviar modelo aprovado</Button></div>
          )}
        </footer>
      )}
      {tplOpen && <TemplateDialog id={id} onClose={() => setTplOpen(false)} onSent={(m) => { setTplOpen(false); invalidate(); onToast(m.status === 'FAILED' ? `Falha: ${m.error ?? ''}` : 'Modelo enviado'); }} />}
      {linkOpen && <LinkDialog id={id} onClose={() => setLinkOpen(false)} onLinked={() => { setLinkOpen(false); invalidate(); }} />}
    </>
  );
}

function TemplateDialog({ id, onClose, onSent }: { id: string; onClose: () => void; onSent: (m: Msg) => void }) {
  const { data, error } = useQuery({ queryKey: ['wa-templates'], queryFn: () => api<Tpl[]>('/atendimento/whatsapp/templates'), retry: false });
  const [sel, setSel] = useState<Tpl | null>(null);
  const [params, setParams] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({ mutationFn: () => api<Msg>(`/atendimento/whatsapp/conversations/${id}/template`, { method: 'POST', body: { name: sel!.name, language: sel!.language, params } }), onSuccess: onSent, onError: (e) => setErr(errMsg(e)) });
  return (
    <Dialog open onClose={onClose} title="Enviar modelo aprovado pela Meta" wide>
      {error ? <div className="alert crit">{errMsg(error)}</div> : !data ? <p className="small muted">Carregando modelos…</p> : data.length === 0 ? <Empty>Nenhum modelo aprovado na conta</Empty> : (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Modelo"><Select value={sel ? `${sel.name}|${sel.language}` : ''} onChange={(e) => { const t = data.find((x) => `${x.name}|${x.language}` === e.target.value) ?? null; setSel(t); setParams(Array<string>(t?.paramCount ?? 0).fill('')); }}><option value="">Selecione…</option>{data.map((t) => <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>{t.name} ({t.language}) · {t.category}</option>)}</Select></Field>
          {sel && <div className="md:col-span-2 small" style={{ whiteSpace: 'pre-wrap', background: 'var(--card2)', padding: 10, borderRadius: 10 }}>{sel.body.replace(/\{\{(\d+)\}\}/g, (_x, i: string) => params[Number(i) - 1] || `{{${i}}}`)}</div>}
          {sel && params.map((p, i) => <Field key={i} label={`Parâmetro {{${i + 1}}}`}><Input value={p} onChange={(e) => setParams(params.map((x, k) => (k === i ? e.target.value : x)))} /></Field>)}
        </div>
      )}
      {err && <div className="alert crit" style={{ marginTop: 10 }}>{err}</div>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => m.mutate()} disabled={m.isPending || !sel || params.some((p) => !p.trim())}>Enviar</Button></div>
    </Dialog>
  );
}

function LinkDialog({ id, onClose, onLinked }: { id: string; onClose: () => void; onLinked: () => void }) {
  const { data: entities } = useQuery({ queryKey: ['entities-lite'], queryFn: () => api<{ entities: Array<{ id: string; name: string; shortName: string | null }> }>('/financeiro/dashboard/filter-options') });
  const [entityId, setEntityId] = useState('');
  const [contactId, setContactId] = useState('');
  const { data: contacts } = useQuery({ queryKey: ['contacts', entityId], queryFn: () => api<Array<{ id: string; name: string; role: string | null }>>(`/financeiro/entities/${entityId}/contacts`), enabled: Boolean(entityId) });
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({ mutationFn: () => api(`/atendimento/whatsapp/conversations/${id}/link-contact`, { method: 'POST', body: { contactId } }), onSuccess: onLinked, onError: (e) => setErr(errMsg(e)) });
  return (
    <Dialog open onClose={onClose} title="Vincular conversa a um contato">
      <div className="grid gap-3"><Field label="Entidade"><Select value={entityId} onChange={(e) => { setEntityId(e.target.value); setContactId(''); }}><option value="">Selecione…</option>{entities?.entities.map((e) => <option key={e.id} value={e.id}>{e.shortName ?? e.name}</option>)}</Select></Field><Field label="Contato"><Select value={contactId} onChange={(e) => setContactId(e.target.value)} disabled={!entityId}><option value="">Selecione…</option>{contacts?.map((c) => <option key={c.id} value={c.id}>{c.name}{c.role ? ` · ${c.role}` : ''}</option>)}</Select></Field></div>
      <p className="small muted">O número desta conversa será gravado como WhatsApp do contato, se ele ainda não tiver um.</p>
      {err && <div className="alert crit" style={{ marginTop: 10 }}>{err}</div>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => m.mutate()} disabled={m.isPending || !contactId}>Vincular</Button></div>
    </Dialog>
  );
}

function StartDialog({ onClose, onStarted }: { onClose: () => void; onStarted: (c: Conv) => void }) {
  const { data: entities } = useQuery({ queryKey: ['entities-lite'], queryFn: () => api<{ entities: Array<{ id: string; name: string; shortName: string | null }> }>('/financeiro/dashboard/filter-options') });
  const [entityId, setEntityId] = useState('');
  const [contactId, setContactId] = useState('');
  const { data: contacts } = useQuery({ queryKey: ['contacts', entityId], queryFn: () => api<Array<{ id: string; name: string; whatsapp: string | null; phone: string | null }>>(`/financeiro/entities/${entityId}/contacts`), enabled: Boolean(entityId) });
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({ mutationFn: () => api<Conv>('/atendimento/whatsapp/start', { method: 'POST', body: { contactId } }), onSuccess: onStarted, onError: (e) => setErr(errMsg(e)) });
  return (
    <Dialog open onClose={onClose} title="Nova conversa">
      <div className="grid gap-3"><Field label="Entidade"><Select value={entityId} onChange={(e) => { setEntityId(e.target.value); setContactId(''); }}><option value="">Selecione…</option>{entities?.entities.map((e) => <option key={e.id} value={e.id}>{e.shortName ?? e.name}</option>)}</Select></Field><Field label="Contato (com WhatsApp)"><Select value={contactId} onChange={(e) => setContactId(e.target.value)} disabled={!entityId}><option value="">Selecione…</option>{contacts?.filter((c) => c.whatsapp || c.phone).map((c) => <option key={c.id} value={c.id}>{c.name} · {c.whatsapp ?? c.phone}</option>)}</Select></Field></div>
      <p className="small muted">Se o contato não escreveu nas últimas 24h, o primeiro envio precisa ser um modelo aprovado.</p>
      {err && <div className="alert crit" style={{ marginTop: 10 }}>{err}</div>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => m.mutate()} disabled={m.isPending || !contactId}>Abrir conversa</Button></div>
    </Dialog>
  );
}
