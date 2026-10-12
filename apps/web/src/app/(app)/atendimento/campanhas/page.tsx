'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { CAMPAIGN_STATUS_LABELS, ENTITY_TYPES, ENTITY_TYPE_LABELS, formatBrDateTime, type CampaignDetail, type CampaignRow, type CampaignStatus, type EntityType } from '@siow/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Dialog, Empty, Field, Input, Select, Table, Td, Textarea, Th, useToast } from '@/components/ui';
import { errMsg } from '@/components/atendimento/ticket-form';

const TONE: Record<string, 'info' | 'warn' | 'good' | 'critical' | 'neutral'> = { DRAFT: 'neutral', RUNNING: 'warn', DONE: 'good', CANCELLED: 'neutral' };
const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

export default function CampaignsPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [toast, showToast] = useToast();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const { data } = useQuery({ queryKey: ['campaigns'], queryFn: () => api<CampaignRow[]>('/atendimento/campanhas') });
  const refresh = (): void => { void qc.invalidateQueries({ queryKey: ['campaigns'] }); void qc.invalidateQueries({ queryKey: ['campaign'] }); };
  return (
    <div>
      <Link href="/atendimento" className="btn sm" style={{ marginBottom: 10 }}>← Atendimento</Link>
      <div className="row between"><div><h1>Campanhas</h1><p className="sub">Comunicação em lote por WhatsApp ou e-mail para um público de entidades/contatos (ex.: novos gestores, renovação, novidades). Usa os provedores e modelos já configurados; sem provedor, cada mensagem fica para envio manual com link pronto.</p></div>{can('tickets.manage') && <Button onClick={() => setCreating(true)}>+ Nova campanha</Button>}</div>
      <div className="card" style={{ marginTop: 12 }}>
        {!data ? <div className="bd small muted">Carregando…</div> : data.length === 0 ? <div className="bd"><Empty>Nenhuma campanha</Empty></div> : (
          <div className="tbl"><Table><thead><tr><Th>Campanha</Th><Th>Canal</Th><Th>Situação</Th><Th className="r">Destinatários</Th><Th className="r">Enviados</Th><Th className="r">Manuais</Th><Th className="r">Falhas</Th><Th className="r">Criada</Th></tr></thead>
            <tbody>{data.map((c) => <tr key={c.id} className="click" onClick={() => setOpenId(c.id)}><Td><span className="link">{c.name}</span>{c.createdByName && <div className="small muted">{c.createdByName}</div>}</Td><Td>{c.channel === 'WHATSAPP' ? 'WhatsApp' : 'E-mail'}</Td><Td><Badge tone={TONE[c.status]}>{CAMPAIGN_STATUS_LABELS[c.status as CampaignStatus] ?? c.status}</Badge></Td><Td className="r num">{c.counts.total}</Td><Td className="r num">{c.counts.sent}</Td><Td className="r num">{c.counts.manual}</Td><Td className="r num">{c.counts.failed}</Td><Td className="r num small">{formatBrDateTime(c.createdAt)}</Td></tr>)}</tbody></Table></div>
        )}
      </div>
      {creating && <CampaignForm onClose={() => setCreating(false)} onSaved={(c) => { setCreating(false); refresh(); setOpenId(c.id); }} />}
      {openId && <CampaignDialog id={openId} onClose={() => setOpenId(null)} onChanged={refresh} onToast={showToast} />}
      {toast}
    </div>
  );
}

function CampaignForm({ onClose, onSaved }: { onClose: () => void; onSaved: (c: CampaignDetail) => void }) {
  const [f, setF] = useState({ name: '', channel: 'WHATSAPP', subject: '', body: 'Olá {{contato}}, aqui é da {{empresa}}. ', entityTypes: [] as string[], ufs: [] as string[], lifecycles: [] as string[], withActiveContract: '', onlyPrimaryContacts: false, onlyFinancialContacts: false });
  const [error, setError] = useState<string | null>(null);
  const audience = { entityTypes: f.entityTypes.length ? f.entityTypes : undefined, ufs: f.ufs.length ? f.ufs : undefined, lifecycles: f.lifecycles.length ? f.lifecycles : undefined, withActiveContract: f.withActiveContract === '' ? null : f.withActiveContract === 'sim', onlyPrimaryContacts: f.onlyPrimaryContacts, onlyFinancialContacts: f.onlyFinancialContacts };
  const { data: prev } = useQuery({ queryKey: ['campaign-preview', audience, f.channel], queryFn: () => api<{ total: number; entities: number; sample: Array<{ entityName: string; contactName: string; recipient: string }>; providerConfigured: boolean }>('/atendimento/campanhas/preview', { method: 'POST', body: { audience, channel: f.channel } }) });
  const m = useMutation({ mutationFn: () => api<CampaignDetail>('/atendimento/campanhas', { method: 'POST', body: { name: f.name, channel: f.channel, subject: f.channel === 'EMAIL' ? f.subject || null : null, body: f.body, audience } }), onSuccess: onSaved, onError: (e) => setError(errMsg(e)) });
  const toggle = (k: 'entityTypes' | 'ufs' | 'lifecycles', v: string): void => setF({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] });
  return (
    <Dialog open onClose={onClose} title="Nova campanha" wide>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Nome"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Canal"><Select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}><option value="WHATSAPP">WhatsApp</option><option value="EMAIL">E-mail</option></Select></Field>
        {f.channel === 'EMAIL' && <Field label="Assunto" className="md:col-span-2"><Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>}
        <Field label="Mensagem (variáveis: {{entidade}}, {{entidade_curta}}, {{contato}}, {{empresa}})" className="md:col-span-2"><Textarea rows={5} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
      </div>
      <h3 style={{ margin: '14px 0 6px' }}>Público</h3>
      <div className="grid gap-3 md:grid-cols-2">
        <div><div className="small muted">Tipo de entidade</div><div className="row" style={{ flexWrap: 'wrap' }}>{ENTITY_TYPES.map((t) => <label key={t} className="row small" style={{ gap: 4 }}><input type="checkbox" checked={f.entityTypes.includes(t)} onChange={() => toggle('entityTypes', t)} /> {ENTITY_TYPE_LABELS[t as EntityType] ?? t}</label>)}</div></div>
        <div><div className="small muted">Ciclo de vida</div><div className="row" style={{ flexWrap: 'wrap' }}>{[['CLIENTE', 'Clientes'], ['EX_CLIENTE', 'Ex-clientes'], ['LEAD', 'Leads/prospects']].map(([k, l]) => <label key={k} className="row small" style={{ gap: 4 }}><input type="checkbox" checked={f.lifecycles.includes(k!)} onChange={() => toggle('lifecycles', k!)} /> {l}</label>)}</div></div>
        <div className="md:col-span-2"><div className="small muted">UF (vazio = todas)</div><div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>{UFS.map((u) => <label key={u} className="row small" style={{ gap: 3 }}><input type="checkbox" checked={f.ufs.includes(u)} onChange={() => toggle('ufs', u)} /> {u}</label>)}</div></div>
        <Field label="Contrato ativo"><Select value={f.withActiveContract} onChange={(e) => setF({ ...f, withActiveContract: e.target.value })}><option value="">Indiferente</option><option value="sim">Somente com contrato ativo</option><option value="nao">Somente sem contrato ativo</option></Select></Field>
        <div className="row" style={{ alignItems: 'flex-end', gap: 14 }}><label className="row small" style={{ gap: 4 }}><input type="checkbox" checked={f.onlyPrimaryContacts} onChange={(e) => setF({ ...f, onlyPrimaryContacts: e.target.checked })} /> só contato principal</label><label className="row small" style={{ gap: 4 }}><input type="checkbox" checked={f.onlyFinancialContacts} onChange={(e) => setF({ ...f, onlyFinancialContacts: e.target.checked })} /> só contato financeiro</label></div>
      </div>
      <div className="alert" style={{ marginTop: 10 }}>{prev ? <><b>{prev.total}</b> destinatário(s) em <b>{prev.entities}</b> entidade(s) com {f.channel === 'WHATSAPP' ? 'WhatsApp/telefone' : 'e-mail'} cadastrado. {prev.providerConfigured ? 'Provedor configurado: envio automático.' : 'Sem provedor configurado: cada mensagem ficará para envio manual (link pronto).'}{prev.sample.length > 0 && <div className="small muted" style={{ marginTop: 4 }}>Amostra: {prev.sample.slice(0, 5).map((s) => `${s.entityName} · ${s.contactName} (${s.recipient})`).join('; ')}</div>}</> : 'Calculando público…'}</div>
      {error && <div className="alert crit" style={{ marginTop: 10 }}>{error}</div>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => m.mutate()} disabled={m.isPending || !f.name || !f.body || !prev?.total}>Criar campanha (rascunho)</Button></div>
    </Dialog>
  );
}

function CampaignDialog({ id, onClose, onChanged, onToast }: { id: string; onClose: () => void; onChanged: () => void; onToast: (m: string) => void }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const { data: c } = useQuery({ queryKey: ['campaign', id], queryFn: () => api<CampaignDetail>(`/atendimento/campanhas/${id}`) });
  const done = (): void => { void qc.invalidateQueries({ queryKey: ['campaign', id] }); onChanged(); };
  const run = useMutation({ mutationFn: () => api<{ processed: number; remaining: number; status: string }>(`/atendimento/campanhas/${id}/run`, { method: 'POST' }), onSuccess: (r) => { done(); onToast(`${r.processed} processado(s), ${r.remaining} restante(s)`); }, onError: (e) => onToast(errMsg(e)) });
  const cancel = useMutation({ mutationFn: () => api(`/atendimento/campanhas/${id}/cancel`, { method: 'POST' }), onSuccess: done, onError: (e) => onToast(errMsg(e)) });
  const del = useMutation({ mutationFn: () => api(`/atendimento/campanhas/${id}`, { method: 'DELETE' }), onSuccess: () => { onChanged(); onClose(); }, onError: (e) => onToast(errMsg(e)) });
  if (!c) return <Dialog open onClose={onClose} title="Campanha"><div className="muted">Carregando…</div></Dialog>;
  const manage = can('tickets.manage');
  return (
    <Dialog open onClose={onClose} title={`${c.name} · ${CAMPAIGN_STATUS_LABELS[c.status as CampaignStatus] ?? c.status}`} wide>
      <p className="small" style={{ whiteSpace: 'pre-wrap', color: 'var(--ink2)' }}>{c.subject ? <b>{c.subject}\n</b> : null}{c.body}</p>
      <div className="row small muted" style={{ gap: 12, flexWrap: 'wrap' }}><span>{c.counts.total} destinatários</span><span>{c.counts.sent} enviados</span><span>{c.counts.manual} manuais</span><span>{c.counts.failed} falhas</span><span>{c.counts.pending} pendentes</span></div>
      {manage && <div className="row" style={{ margin: '10px 0', gap: 6 }}>{c.counts.pending > 0 && c.status !== 'CANCELLED' && <Button onClick={() => run.mutate()} disabled={run.isPending}>{run.isPending ? 'Enviando…' : c.status === 'DRAFT' ? 'Iniciar envio' : 'Continuar envio'}</Button>}{(c.status === 'DRAFT' || c.status === 'RUNNING') && <Button variant="secondary" onClick={() => cancel.mutate()}>Cancelar campanha</Button>}{c.status !== 'RUNNING' && <Button variant="ghost" onClick={() => { if (confirm('Excluir a campanha?')) del.mutate(); }}>Excluir</Button>}</div>}
      <div className="tbl" style={{ maxHeight: 360, overflow: 'auto' }}><Table><thead><tr><Th>Entidade</Th><Th>Contato</Th><Th>Destino</Th><Th>Situação</Th><Th /></tr></thead><tbody>{c.recipients.map((r) => <tr key={r.id}><Td className="small">{r.entityName}</Td><Td className="small">{r.contactName ?? '—'}</Td><Td className="small num">{r.recipient ?? '—'}</Td><Td><Badge tone={r.status === 'SENT' ? 'good' : r.status === 'FAILED' ? 'critical' : r.status === 'MANUAL_PENDING' ? 'warn' : 'neutral'}>{({ PENDING: 'pendente', SENT: 'enviado', MANUAL_PENDING: 'envio manual', FAILED: 'falhou', SKIPPED: 'ignorado' } as Record<string, string>)[r.status] ?? r.status}</Badge>{r.error && <div className="small muted">{r.error}</div>}</Td><Td className="r">{r.manualLink && <a className="btn sm" href={r.manualLink} target="_blank" rel="noopener noreferrer">Abrir</a>}</Td></tr>)}</tbody></Table></div>
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Fechar</Button></div>
    </Dialog>
  );
}
