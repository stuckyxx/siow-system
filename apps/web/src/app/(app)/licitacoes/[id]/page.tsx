'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { TENDER_DEADLINE_KINDS, TENDER_DEADLINE_KIND_LABELS, TENDER_MODALITY_LABELS, TENDER_STATUSES, TENDER_STATUS_LABELS, formatBRL, formatBrDate, formatBrDateTime, toBrDateTimeInput, type TenderDeadlineKind, type TenderDetail, type TenderModality } from '@siow/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Dialog, Empty, Field, Input, Select, Stat, Table, Tabs, Td, Textarea, Th, useToast } from '@/components/ui';
import { TenderForm, errMsg } from '@/components/tenders/tender-form';
import { TenderStatusBadge } from '@/components/tenders/tenders-table';
import { FormalizeDialog } from '@/components/crm/opportunity-dialogs';

const TABS = [{ key: 'prazos', label: 'Prazos' }, { key: 'checklist', label: 'Checklist de habilitação' }, { key: 'concorrentes', label: 'Concorrentes e resultado' }, { key: 'documentos', label: 'Documentos' }, { key: 'historico', label: 'Histórico' }];
const EVENT_LABELS: Record<string, string> = { CREATED: 'Criada', UPDATED: 'Atualizada', STATUS_CHANGED: 'Situação alterada', DEADLINE_ADDED: 'Prazo adicionado', DEADLINE_DONE: 'Prazo cumprido', DEADLINE_REOPENED: 'Prazo reaberto', DEADLINE_REMOVED: 'Prazo removido', COMPETITOR_ADDED: 'Concorrente registrado', CHECKLIST_ADDED: 'Item de checklist', CHECKLIST_DONE: 'Item do checklist concluído', CHECKLIST_REOPENED: 'Item do checklist reaberto', DOCUMENT_ADDED: 'Documento anexado', DOCUMENT_UPLOADED: 'Documento anexado', FORMALIZED: 'Contrato formalizado', WON: 'Vencida', LOST: 'Perdida', IMPORTED: 'Importada' };
const CERT_TONE: Record<string, 'good' | 'warn' | 'critical' | 'neutral'> = { VALID: 'good', EXPIRING: 'warn', EXPIRED: 'critical', MISSING: 'critical' };
const CERT_LABEL: Record<string, string> = { VALID: 'válida', EXPIRING: 'vence em breve', EXPIRED: 'vencida', MISSING: 'sem validade cadastrada' };
interface DocRow { id: string; name: string; capturedAt: string; blob: { size: number } }

export default function TenderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useAuth();
  const [toast, showToast] = useToast();
  const [tab, setTab] = useState('prazos');
  const [dialog, setDialog] = useState<'edit' | 'status' | 'formalize' | null>(null);
  const { data: t } = useQuery({ queryKey: ['tender', id], queryFn: () => api<TenderDetail>(`/licitacoes/${id}`) });
  const refresh = (): void => { for (const k of ['tender', 'tenders', 'tender-calendar', 'tender-docs', 'contracts', 'dashboard']) void qc.invalidateQueries({ queryKey: [k] }); };
  const del = useMutation({ mutationFn: () => api(`/licitacoes/${id}`, { method: 'DELETE' }), onSuccess: () => router.push('/licitacoes'), onError: (e) => showToast(errMsg(e)) });
  if (!t) return <div className="muted">Carregando…</div>;
  const write = can('tenders.write');
  const canFormalize = write && can('contracts.write') && (t.status === 'WON' || t.status === 'HOMOLOGATED') && !t.contractId;
  return (
    <div>
      <Link href="/licitacoes" className="btn sm" style={{ marginBottom: 10 }}>← Licitações</Link>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="small muted"><Link href={`/financeiro/entidades/${t.entity.id}?tab=licitacoes`}>{t.entity.name}</Link> · {t.entity.municipality}/{t.entity.uf}{t.officialId ? ` · PNCP ${t.officialId}` : ''}{t.source !== 'MANUAL' ? ` · origem ${t.source}` : ''}</div>
          <h1>{TENDER_MODALITY_LABELS[t.modality as TenderModality] ?? t.modality} {t.number}{t.year ? `/${t.year}` : ''}</h1>
          <div className="row small muted"><TenderStatusBadge status={t.status} />{t.owner && <span>responsável {t.owner.name}</span>}{t.portalUrl && <a href={t.portalUrl} target="_blank" rel="noopener noreferrer" className="link">edital / portal ↗</a>}{t.contractId && <Link href={`/financeiro/contratos/${t.contractId}`}>· ver contrato</Link>}{t.opportunityId && <Link href={`/comercial/oportunidades/${t.opportunityId}`}>· oportunidade</Link>}</div>
          <p className="small" style={{ margin: '6px 0 0', color: 'var(--ink2)', maxWidth: 860 }}>{t.object}</p>
        </div>
        <div className="row">
          {write && <Button variant="secondary" onClick={() => setDialog('edit')}>Editar</Button>}
          {write && <Button onClick={() => setDialog('status')}>Mudar situação</Button>}
          {canFormalize && <Button onClick={() => setDialog('formalize')}>Formalizar contrato</Button>}
          {write && !t.contractId && <Button variant="ghost" onClick={() => { if (confirm('Excluir esta licitação?')) del.mutate(); }}>Excluir</Button>}
        </div>
      </div>
      <div className="g5" style={{ marginTop: 12 }}>
        <Stat small label="Valor estimado" value={t.estimatedValue ? formatBRL(t.estimatedValue) : '—'} tone="info" />
        <Stat small label="Nossa proposta" value={t.ourProposalValue ? formatBRL(t.ourProposalValue) : '—'} hint={t.winnerValue ? `vencedora ${formatBRL(t.winnerValue)}` : undefined} />
        <Stat small label="Proposta até" value={t.proposalDeadline ? formatBrDateTime(t.proposalDeadline) : '—'} tone={t.proposalDeadline && new Date(t.proposalDeadline) < new Date() && ['IDENTIFIED', 'ANALYZING', 'PREPARING'].includes(t.status) ? 'critical' : undefined} />
        <Stat small label="Sessão pública" value={t.sessionAt ? formatBrDateTime(t.sessionAt) : '—'} />
        <Stat small label="Checklist" value={t.checklistTotal ? `${t.checklistDone}/${t.checklistTotal}` : '—'} hint={t.checklistBlocked ? `${t.checklistBlocked} item(ns) com certidão vencida/ausente` : 'nenhum bloqueio'} tone={t.checklistBlocked ? 'critical' : t.checklistTotal && t.checklistDone === t.checklistTotal ? 'good' : undefined} />
      </div>
      {t.status === 'LOST' && t.lossReason && <div className="alert crit" style={{ marginTop: 8 }}>Perdida: {t.lossReason}{t.winnerValue ? ` · proposta vencedora ${formatBRL(t.winnerValue)}` : ''}</div>}
      {(t.status === 'WON' || t.status === 'HOMOLOGATED') && !t.contractId && <div className="alert good" style={{ marginTop: 8 }}>{t.status === 'HOMOLOGATED' ? `Homologada em ${formatBrDate(t.homologatedAt)}.` : 'Vencida.'} Use "Formalizar contrato" para iniciar a contratação (rascunho até confirmar).</div>}
      <Tabs tabs={[{ ...TABS[0]!, count: t.openDeadlines }, { ...TABS[1]!, count: t.checklistTotal }, { ...TABS[2]!, count: t.competitors.length }, TABS[3]!, TABS[4]!]} value={tab} onChange={setTab} />
      {tab === 'prazos' && <Deadlines t={t} write={write} onChanged={refresh} onError={showToast} />}
      {tab === 'checklist' && <Checklist t={t} write={write} onChanged={refresh} onError={showToast} />}
      {tab === 'concorrentes' && <Competitors t={t} write={write} onChanged={refresh} onError={showToast} />}
      {tab === 'documentos' && <Documents t={t} write={write} onError={showToast} />}
      {tab === 'historico' && <div className="card"><div className="bd"><ul className="hist">{t.events.map((e) => <li key={e.id}><div className="row between"><span><b>{EVENT_LABELS[e.action] ?? e.action.replace(/_/g, ' ').toLowerCase()}</b>{e.fromValue && e.toValue ? ` · ${e.fromValue} → ${e.toValue}` : e.toValue ? ` · ${e.toValue}` : ''}{e.notes ? <span className="muted"> — {e.notes}</span> : null}</span><span className="small muted">{formatBrDateTime(e.createdAt)}{e.userName ? ` · ${e.userName}` : ''}</span></div></li>)}</ul></div></div>}
      {dialog === 'edit' && <TenderForm tender={t} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); refresh(); }} />}
      {dialog === 'status' && <StatusDialog t={t} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); }} />}
      {dialog === 'formalize' && <FormalizeDialog open opportunity={{ id: t.id, title: t.object, entity: { ...t.entity, type: '' }, monthlyAmount: null, totalAmount: t.ourProposalValue, owner: t.owner } as never} endpoint={`/licitacoes/${t.id}/formalize`} onClose={() => setDialog(null)} onDone={(r) => { setDialog(null); refresh(); showToast(r.status === 'ACTIVE' ? 'Contrato criado e ativo' : 'Rascunho de contrato criado — ative-o na ficha do contrato quando assinado'); }} />}
      {toast}
    </div>
  );
}

function StatusDialog({ t, onClose, onDone }: { t: TenderDetail; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ status: t.status, notes: '', lossReason: '', winnerValue: t.winnerValue?.replace('.', ',') ?? '', ourProposalValue: t.ourProposalValue?.replace('.', ',') ?? '', resultAt: t.resultAt ?? '', homologatedAt: t.homologatedAt ?? '' });
  const [error, setError] = useState<string | null>(null);
  const b = (k: keyof typeof f) => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }) });
  const m = useMutation({ mutationFn: () => api(`/licitacoes/${t.id}/status`, { method: 'POST', body: { status: f.status, notes: f.notes || null, lossReason: f.lossReason || null, winnerValue: f.winnerValue ? f.winnerValue.replace(/\./g, '').replace(',', '.') : null, ourProposalValue: f.ourProposalValue ? f.ourProposalValue.replace(/\./g, '').replace(',', '.') : null, resultAt: f.resultAt || null, homologatedAt: f.homologatedAt || null } }), onSuccess: onDone, onError: (e) => setError(errMsg(e)) });
  const closing = ['WON', 'LOST', 'HOMOLOGATED', 'DESERTED'].includes(f.status);
  return (
    <Dialog open onClose={onClose} title="Mudar situação da licitação">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Situação" className="md:col-span-2"><Select {...b('status')}>{TENDER_STATUSES.map((s) => <option key={s} value={s}>{TENDER_STATUS_LABELS[s]}</option>)}</Select></Field>
        {['SUBMITTED', 'IN_SESSION', 'WON', 'LOST', 'HOMOLOGATED'].includes(f.status) && <Field label="Nossa proposta (R$)"><Input {...b('ourProposalValue')} /></Field>}
        {closing && <Field label="Proposta vencedora (R$)"><Input {...b('winnerValue')} /></Field>}
        {closing && <Field label="Data do resultado"><Input type="date" {...b('resultAt')} /></Field>}
        {f.status === 'HOMOLOGATED' && <Field label="Data da homologação"><Input type="date" {...b('homologatedAt')} /></Field>}
        {f.status === 'LOST' && <Field label="Motivo da perda" className="md:col-span-2"><Select {...b('lossReason')}><option value="">—</option>{['Preço', 'Desclassificação técnica', 'Inabilitação (documentação)', 'Concorrente melhor avaliado', 'Prazo perdido', 'Outro'].map((r) => <option key={r} value={r}>{r}</option>)}</Select></Field>}
        <Field label="Observações" className="md:col-span-2"><Textarea rows={2} {...b('notes')} /></Field>
      </div>
      {t.opportunityId && <p className="small muted">A oportunidade ligada será marcada como ganha (vencida/homologada) ou perdida (perdida/cancelada/deserta).</p>}
      {error && <div className="alert crit" style={{ marginTop: 10 }}>{error}</div>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => m.mutate()} disabled={m.isPending}>Salvar</Button></div>
    </Dialog>
  );
}

function Deadlines({ t, write, onChanged, onError }: { t: TenderDetail; write: boolean; onChanged: () => void; onError: (m: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ kind: 'OTHER', title: '', dueAt: `${toBrDateTimeInput(new Date()).slice(0, 10)}T09:00`, notes: '' });
  const add = useMutation({ mutationFn: () => api(`/licitacoes/${t.id}/deadlines`, { method: 'POST', body: { ...f, notes: f.notes || null } }), onSuccess: () => { setAdding(false); setF({ kind: 'OTHER', title: '', dueAt: `${toBrDateTimeInput(new Date()).slice(0, 10)}T09:00`, notes: '' }); onChanged(); }, onError: (e) => onError(errMsg(e)) });
  const toggle = useMutation({ mutationFn: (v: { id: string; done: boolean }) => api(`/licitacoes/${t.id}/deadlines/${v.id}`, { method: 'PATCH', body: { done: v.done } }), onSuccess: onChanged, onError: (e) => onError(errMsg(e)) });
  const remove = useMutation({ mutationFn: (id: string) => api(`/licitacoes/${t.id}/deadlines/${id}`, { method: 'DELETE' }), onSuccess: onChanged, onError: (e) => onError(errMsg(e)) });
  return (
    <div>
      {write && <div className="row" style={{ marginBottom: 8, justifyContent: 'flex-end' }}><Button size="sm" onClick={() => setAdding(true)}>+ Prazo</Button></div>}
      <div className="card">{t.deadlines.length === 0 ? <div className="bd"><Empty>Nenhum prazo</Empty></div> : <div className="tbl"><Table><thead><tr><Th /><Th>Prazo</Th><Th>Tipo</Th><Th>Data/hora</Th><Th>Faltam</Th><Th /></tr></thead><tbody>{t.deadlines.map((d) => <tr key={d.id} style={{ opacity: d.done ? 0.6 : 1 }}><Td>{write && <input type="checkbox" checked={d.done} onChange={(e) => toggle.mutate({ id: d.id, done: e.target.checked })} />}</Td><Td><b>{d.title}</b>{d.notes && <div className="small muted">{d.notes}</div>}</Td><Td className="small">{TENDER_DEADLINE_KIND_LABELS[d.kind as TenderDeadlineKind] ?? d.kind}</Td><Td className="num">{formatBrDateTime(d.dueAt)}</Td><Td className="small">{d.done ? <Badge tone="good">cumprido</Badge> : d.overdue ? <Badge tone="critical">vencido há {-d.daysLeft} dia(s)</Badge> : <Badge tone={d.daysLeft <= 3 ? 'warn' : 'neutral'}>{d.daysLeft} dia(s)</Badge>}</Td><Td className="r">{write && <Button size="sm" variant="ghost" onClick={() => remove.mutate(d.id)}>Remover</Button>}</Td></tr>)}</tbody></Table></div>}</div>
      {adding && <Dialog open onClose={() => setAdding(false)} title="Novo prazo"><div className="grid gap-3 md:grid-cols-2"><Field label="Tipo"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value, title: f.title || TENDER_DEADLINE_KIND_LABELS[e.target.value as TenderDeadlineKind] })}>{TENDER_DEADLINE_KINDS.map((k) => <option key={k} value={k}>{TENDER_DEADLINE_KIND_LABELS[k]}</option>)}</Select></Field><Field label="Data/hora"><Input type="datetime-local" value={f.dueAt} onChange={(e) => setF({ ...f, dueAt: e.target.value })} /></Field><Field label="Título" className="md:col-span-2"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field><Field label="Observações" className="md:col-span-2"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field></div><div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={() => setAdding(false)}>Cancelar</Button><Button onClick={() => add.mutate()} disabled={add.isPending || !f.title || !f.dueAt}>Salvar</Button></div></Dialog>}
    </div>
  );
}

function Checklist({ t, write, onChanged, onError }: { t: TenderDetail; write: boolean; onChanged: () => void; onError: (m: string) => void }) {
  const [title, setTitle] = useState('');
  const add = useMutation({ mutationFn: () => api(`/licitacoes/${t.id}/checklist`, { method: 'POST', body: { title, required: true } }), onSuccess: () => { setTitle(''); onChanged(); }, onError: (e) => onError(errMsg(e)) });
  const toggle = useMutation({ mutationFn: (v: { id: string; done: boolean }) => api(`/licitacoes/${t.id}/checklist/${v.id}`, { method: 'PATCH', body: { done: v.done } }), onSuccess: onChanged, onError: (e) => onError(errMsg(e)) });
  const remove = useMutation({ mutationFn: (id: string) => api(`/licitacoes/${t.id}/checklist/${id}`, { method: 'DELETE' }), onSuccess: onChanged, onError: (e) => onError(errMsg(e)) });
  return (
    <div>
      <p className="small muted" style={{ margin: '0 0 8px' }}>Itens ligados a certidões mostram a validade na data da sessão{t.sessionAt ? ` (${formatBrDate(t.sessionAt.slice(0, 10))})` : ''}: vencida ou sem validade bloqueia a habilitação. Renove em <Link href="/financeiro/certidoes">Certidões</Link>.</p>
      {write && <div className="row" style={{ marginBottom: 8 }}><Input placeholder="Novo item do checklist" value={title} onChange={(e) => setTitle(e.target.value)} style={{ minWidth: 320 }} /><Button size="sm" onClick={() => add.mutate()} disabled={!title || add.isPending}>Adicionar</Button></div>}
      <div className="card">{t.checklist.length === 0 ? <div className="bd"><Empty>Checklist vazio</Empty></div> : <div className="tbl"><Table><thead><tr><Th /><Th>Item</Th><Th>Certidão</Th><Th /></tr></thead><tbody>{t.checklist.map((c) => <tr key={c.id} style={{ opacity: c.done ? 0.6 : 1 }}><Td>{write && <input type="checkbox" checked={c.done} onChange={(e) => toggle.mutate({ id: c.id, done: e.target.checked })} />}</Td><Td><b>{c.title}</b>{!c.required && <span className="small muted"> · opcional</span>}{c.notes && <div className="small muted">{c.notes}</div>}</Td><Td className="small">{c.certificateId ? <><Badge tone={CERT_TONE[c.certificateStatus ?? 'MISSING']}>{CERT_LABEL[c.certificateStatus ?? 'MISSING']}</Badge>{c.certificateValidUntil && <span className="muted"> até {formatBrDate(c.certificateValidUntil)}</span>}</> : <span className="muted">—</span>}</Td><Td className="r">{write && <Button size="sm" variant="ghost" onClick={() => remove.mutate(c.id)}>Remover</Button>}</Td></tr>)}</tbody></Table></div>}</div>
    </div>
  );
}

function Competitors({ t, write, onChanged, onError }: { t: TenderDetail; write: boolean; onChanged: () => void; onError: (m: string) => void }) {
  const [f, setF] = useState({ name: '', document: '', proposalValue: '', rank: '', isWinner: false });
  const add = useMutation({ mutationFn: () => api(`/licitacoes/${t.id}/competitors`, { method: 'POST', body: { name: f.name, document: f.document || null, proposalValue: f.proposalValue ? f.proposalValue.replace(/\./g, '').replace(',', '.') : null, rank: f.rank ? Number(f.rank) : null, isWinner: f.isWinner } }), onSuccess: () => { setF({ name: '', document: '', proposalValue: '', rank: '', isWinner: false }); onChanged(); }, onError: (e) => onError(errMsg(e)) });
  const remove = useMutation({ mutationFn: (id: string) => api(`/licitacoes/${t.id}/competitors/${id}`, { method: 'DELETE' }), onSuccess: onChanged, onError: (e) => onError(errMsg(e)) });
  return (
    <div>
      {write && <div className="grid gap-2" style={{ gridTemplateColumns: '2fr 1fr 1fr .6fr auto auto', marginBottom: 8, alignItems: 'end' }}><Input placeholder="Concorrente" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /><Input placeholder="CNPJ" value={f.document} onChange={(e) => setF({ ...f, document: e.target.value })} /><Input placeholder="Proposta (R$)" value={f.proposalValue} onChange={(e) => setF({ ...f, proposalValue: e.target.value })} /><Input placeholder="Rank" value={f.rank} onChange={(e) => setF({ ...f, rank: e.target.value })} /><label className="row small" style={{ gap: 4 }}><input type="checkbox" checked={f.isWinner} onChange={(e) => setF({ ...f, isWinner: e.target.checked })} /> vencedor</label><Button size="sm" onClick={() => add.mutate()} disabled={!f.name || add.isPending}>Adicionar</Button></div>}
      <div className="card">{t.competitors.length === 0 ? <div className="bd"><Empty>Nenhum concorrente registrado</Empty></div> : <div className="tbl"><Table><thead><tr><Th>#</Th><Th>Concorrente</Th><Th>CNPJ</Th><Th className="r">Proposta</Th><Th /><Th /></tr></thead><tbody>{t.competitors.map((c) => <tr key={c.id}><Td className="num">{c.rank ?? '—'}</Td><Td><b>{c.name}</b>{c.notes && <div className="small muted">{c.notes}</div>}</Td><Td className="small">{c.document ?? '—'}</Td><Td className="r num">{c.proposalValue ? formatBRL(c.proposalValue) : '—'}</Td><Td>{c.isWinner && <Badge tone="good">vencedor</Badge>}</Td><Td className="r">{write && <Button size="sm" variant="ghost" onClick={() => remove.mutate(c.id)}>Remover</Button>}</Td></tr>)}</tbody></Table></div>}</div>
    </div>
  );
}

function Documents({ t, write, onError }: { t: TenderDetail; write: boolean; onError: (m: string) => void }) {
  const qc = useQueryClient();
  const ref = useRef<HTMLInputElement>(null);
  const { data } = useQuery({ queryKey: ['tender-docs', t.id], queryFn: () => api<DocRow[]>(`/licitacoes/${t.id}/documents`) });
  const upload = useMutation({ mutationFn: (file: File) => { const fd = new FormData(); fd.append('file', file); fd.append('name', file.name); return api(`/licitacoes/${t.id}/documents`, { method: 'POST', formData: fd }); }, onSuccess: () => { void qc.invalidateQueries({ queryKey: ['tender-docs', t.id] }); void qc.invalidateQueries({ queryKey: ['tender', t.id] }); }, onError: (e) => onError(errMsg(e)) });
  const open = async (id: string): Promise<void> => { const r = await api<{ url: string }>(`/documents/${id}/download-url`); window.open(r.url, '_blank', 'noopener'); };
  return (
    <div>
      {write && <div className="row" style={{ marginBottom: 8, justifyContent: 'flex-end' }}><input ref={ref} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} /><Button size="sm" onClick={() => ref.current?.click()} disabled={upload.isPending}>{upload.isPending ? 'Enviando…' : 'Anexar edital / anexo / proposta'}</Button></div>}
      <div className="card">{!data ? <div className="bd small muted">Carregando…</div> : data.length === 0 ? <div className="bd"><Empty>Nenhum documento</Empty></div> : <div className="bd"><ul className="hist">{data.map((d) => <li key={d.id} className="row between"><span>📄 {d.name} <span className="small muted">· {Math.max(1, Math.round(d.blob.size / 1024))} KB · {formatBrDateTime(d.capturedAt)}</span></span><Button size="sm" variant="secondary" onClick={() => void open(d.id).catch((e) => onError(errMsg(e)))}>Abrir</Button></li>)}</ul></div>}</div>
    </div>
  );
}
