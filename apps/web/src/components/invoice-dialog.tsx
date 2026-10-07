'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { COLLECTION_STATUSES, COLLECTION_STATUS_LABELS, INVOICE_STATUS_LABELS, MESSAGE_CHANNEL_LABELS, formatBRL, formatBrDate, formatBrDateTime, formatCompetence, type CollectionStatus, type InvoiceStatus } from '@siow/shared';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { InvoiceStatusBadge, CollectionStatusBadge } from './status';
import { Badge, Button, Dialog, Field, Input, Select, Tabs, Textarea } from './ui';

interface InvoiceDetail {
  id: string; number: string; competenceMonth: number; competenceYear: number; amount: string; issueDate: string | null; status: InvoiceStatus; paidAt: string | null; paidAmount: string | null;
  description: string | null; needsReconciliation: boolean; reconciliationNote: string | null; manualOverride: boolean; overrideJustification: string | null; daysOverdue: number | null; documentUrl: string | null; missingSince: string | null;
  entity: { id: string; name: string; shortName: string | null }; contract: { id: string; number: string } | null; overriddenBy: { name: string } | null;
  documents: Array<{ id: string; name: string; type: string; capturedAt: string }>;
  events: Array<{ id: string; type: string; field: string | null; oldValue: string | null; newValue: string | null; origin: string; note: string | null; createdAt: string; user: { name: string } | null }>;
  conflicts: Array<{ id: string; field: string; manualValue: string | null; sourceValue: string | null; status: string; createdAt: string }>;
  collectionCase: { status: CollectionStatus; nextActionAt: string | null; attempts: Array<{ id: string; performedAt: string; channel: string; message: string | null; response: string | null; resultingStatus: CollectionStatus; performedBy: { name: string } | null; contact: { name: string } | null }> } | null;
}

const EVENT_LABEL: Record<string, string> = { CREATED: 'Cadastrada', STATUS_CHANGED: 'Status alterado', FIELD_CHANGED: 'Campo alterado', MISSING_FROM_SOURCE: 'Sumiu da fonte', REAPPEARED: 'Voltou à fonte', MANUAL_OVERRIDE: 'Alteração manual', RECONCILED: 'Verificada', CONFLICT_DETECTED: 'Conflito detectado', CONFLICT_RESOLVED: 'Conflito resolvido', NOTE: 'Observação' };
const ORIGIN_LABEL: Record<string, string> = { SYNC: 'sincronização automática', MANUAL: 'manual', IMPORT: 'importação', SYSTEM: 'sistema' };

export function InvoiceDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState('overview');
  const { data, refetch } = useQuery({ queryKey: ['invoice', id], queryFn: () => api<InvoiceDetail>(`/financeiro/invoices/${id}`), enabled: Boolean(id) });
  const capture = useMutation({ mutationFn: () => api(`/financeiro/invoices/${id}/capture-document`, { method: 'POST' }) });
  const download = async (docId: string): Promise<void> => {
    const r = await api<{ url: string }>(`/documents/${docId}/download-url`);
    window.open(r.url, '_blank', 'noopener');
  };
  const invalidate = (): void => { refetch(); qc.invalidateQueries({ queryKey: ['invoices'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); };

  return (
    <Dialog open={Boolean(id)} onClose={onClose} title={data ? `Nota ${data.number} — ${data.entity.shortName ?? data.entity.name}` : 'Nota'} wide>
      {!data ? <div className="text-sm text-ink-3">Carregando…</div> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <Info label="Competência" value={formatCompetence({ competenceMonth: data.competenceMonth, competenceYear: data.competenceYear })} />
            <Info label="Valor" value={formatBRL(data.amount)} />
            <Info label="Emissão" value={formatBrDate(data.issueDate)} />
            <Info label="Situação" value={<InvoiceStatusBadge status={data.status} />} />
            <Info label="Pagamento" value={data.paidAt ? `${formatBrDate(data.paidAt)} · ${formatBRL(data.paidAmount ?? data.amount)}` : '—'} />
            <Info label="Dias em atraso" value={data.daysOverdue ? `${data.daysOverdue}` : '—'} />
            <Info label="Contrato" value={data.contract?.number ?? '—'} />
            <Info label="Cobrança" value={<CollectionStatusBadge status={data.collectionCase?.status ?? null} />} />
          </div>
          {data.description && <p className="rounded-md bg-surface p-3 text-sm text-ink-2">{data.description}</p>}
          {data.needsReconciliation && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><strong>Precisa de verificação:</strong> {data.reconciliationNote}{data.missingSince && ` (desde ${formatBrDateTime(data.missingSince)})`}</div>}
          {data.manualOverride && <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800"><strong>Alteração manual protegida</strong>{data.overriddenBy && ` por ${data.overriddenBy.name}`}: {data.overrideJustification}</div>}
          {data.conflicts.filter((c) => c.status === 'OPEN').map((c) => <ConflictCard key={c.id} invoiceId={data.id} conflict={c} onDone={invalidate} canResolve={can('invoices.reconcile')} />)}

          <Tabs value={tab} onChange={setTab} tabs={[{ key: 'overview', label: 'Ações' }, { key: 'collection', label: 'Cobrança', count: data.collectionCase?.attempts.length }, { key: 'documents', label: 'Documentos', count: data.documents.length }, { key: 'history', label: 'Histórico', count: data.events.length }]} />

          {tab === 'overview' && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {data.documents.length === 0 && data.documentUrl && can('documents.write') && <Button variant="secondary" onClick={() => capture.mutate()} disabled={capture.isPending}>{capture.isSuccess ? 'Captura solicitada' : 'Baixar nota do portal'}</Button>}
                {data.documents[0] && <Button variant="secondary" onClick={() => download(data.documents[0]!.id)}>Abrir documento</Button>}
              </div>
              {can('invoices.override') && <OverrideForm invoice={data} onDone={invalidate} />}
              {data.needsReconciliation && can('invoices.reconcile') && <ReconcileForm invoice={data} onDone={invalidate} />}
            </div>
          )}
          {tab === 'collection' && <CollectionPanel invoice={data} onDone={invalidate} canManage={can('collections.manage')} />}
          {tab === 'documents' && (
            <ul className="divide-y divide-line text-sm">
              {data.documents.length === 0 && <li className="py-3 text-ink-3">Nenhum documento armazenado. {data.documentUrl ? 'Use "Baixar nota do portal" para capturar uma cópia segura.' : ''}</li>}
              {data.documents.map((d) => <li key={d.id} className="flex items-center justify-between py-2"><span>{d.name} <span className="text-xs text-ink-3">· {formatBrDateTime(d.capturedAt)}</span></span><Button size="sm" variant="secondary" onClick={() => download(d.id)}>Baixar</Button></li>)}
            </ul>
          )}
          {tab === 'history' && (
            <ul className="divide-y divide-line text-sm">
              {data.events.map((e) => (
                <li key={e.id} className="py-2">
                  <div className="flex items-center gap-2"><Badge tone={e.type === 'CONFLICT_DETECTED' || e.type === 'MISSING_FROM_SOURCE' ? 'critical' : e.origin === 'MANUAL' ? 'info' : 'neutral'}>{EVENT_LABEL[e.type] ?? e.type}</Badge><span className="text-xs text-ink-3">{formatBrDateTime(e.createdAt)} · {ORIGIN_LABEL[e.origin] ?? e.origin}{e.user ? ` · ${e.user.name}` : ''}</span></div>
                  {e.field && <div className="mt-1 text-ink-2">{e.field}: <span className="line-through">{label(e.field, e.oldValue)}</span> → <strong>{label(e.field, e.newValue)}</strong></div>}
                  {e.note && <div className="mt-1 text-ink-2">{e.note}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Dialog>
  );
}

function label(field: string, v: string | null): string {
  if (v === null) return '—';
  if (field === 'status') return INVOICE_STATUS_LABELS[v as InvoiceStatus] ?? v;
  if (field === 'paidAt' || field === 'issueDate') return formatBrDate(v);
  if (field === 'amount' || field === 'paidAmount') return formatBRL(v);
  return v;
}

function Info({ label: l, value }: { label: string; value: React.ReactNode }) {
  return <div><div className="text-xs text-ink-3">{l}</div><div className="font-medium tabular-nums">{value}</div></div>;
}

function ConflictCard({ invoiceId, conflict, onDone, canResolve }: { invoiceId: string; conflict: InvoiceDetail['conflicts'][number]; onDone: () => void; canResolve: boolean }) {
  const resolve = useMutation({ mutationFn: (resolution: 'KEPT_MANUAL' | 'ACCEPTED_SOURCE') => api(`/financeiro/invoices/${invoiceId}/conflicts/${conflict.id}/resolve`, { method: 'POST', body: { resolution } }), onSuccess: onDone });
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <strong>Conflito em "{conflict.field}"</strong>: valor manual <em>{label(conflict.field, conflict.manualValue)}</em> × fonte <em>{label(conflict.field, conflict.sourceValue)}</em> <span className="text-xs">({formatBrDateTime(conflict.createdAt)})</span>
      {canResolve && <div className="mt-2 flex gap-2"><Button size="sm" variant="secondary" onClick={() => resolve.mutate('KEPT_MANUAL')}>Manter manual</Button><Button size="sm" onClick={() => resolve.mutate('ACCEPTED_SOURCE')}>Aceitar fonte</Button></div>}
    </div>
  );
}

function OverrideForm({ invoice, onDone }: { invoice: InvoiceDetail; onDone: () => void }) {
  const [openForm, setOpenForm] = useState(false);
  const [status, setStatus] = useState<InvoiceStatus>(invoice.status);
  const [paidAt, setPaidAt] = useState(invoice.paidAt ?? '');
  const [amount, setAmount] = useState(invoice.amount);
  const [justification, setJustification] = useState('');
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => api(`/financeiro/invoices/${invoice.id}/override`, { method: 'PATCH', body: { status, paidAt: paidAt || null, amount, justification } }),
    onSuccess: () => { setOpenForm(false); setJustification(''); onDone(); },
    onError: (e) => setError(e instanceof ApiError ? e.message + (e.issues ? ': ' + e.issues.map((i) => i.message).join('; ') : '') : 'Erro'),
  });
  if (!openForm) return <Button variant="secondary" onClick={() => setOpenForm(true)}>Alterar manualmente (com justificativa)</Button>;
  return (
    <div className="rounded-md border border-line p-3">
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Situação"><Select value={status} onChange={(e) => setStatus(e.target.value as InvoiceStatus)}>{(Object.keys(INVOICE_STATUS_LABELS) as InvoiceStatus[]).map((s) => <option key={s} value={s}>{INVOICE_STATUS_LABELS[s]}</option>)}</Select></Field>
        <Field label="Data do pagamento"><Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} /></Field>
        <Field label="Valor"><Input value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Justificativa (obrigatória)" className="md:col-span-3"><Textarea rows={2} value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="Ex.: pagamento confirmado por extrato bancário em 02/10" /></Field>
      </div>
      {error && <p className="mt-2 text-sm text-critical">{error}</p>}
      <div className="mt-3 flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpenForm(false)}>Cancelar</Button><Button onClick={() => m.mutate()} disabled={m.isPending || justification.length < 10}>Salvar alteração</Button></div>
    </div>
  );
}

function ReconcileForm({ invoice, onDone }: { invoice: InvoiceDetail; onDone: () => void }) {
  const [status, setStatus] = useState<InvoiceStatus>(invoice.status);
  const [paidAt, setPaidAt] = useState('');
  const [note, setNote] = useState('');
  const m = useMutation({ mutationFn: () => api(`/financeiro/invoices/${invoice.id}/reconcile`, { method: 'POST', body: { status, paidAt: paidAt || null, note } }), onSuccess: onDone });
  return (
    <div className="rounded-md border border-red-200 p-3">
      <div className="mb-2 text-sm font-medium">Resolver verificação</div>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Situação confirmada"><Select value={status} onChange={(e) => setStatus(e.target.value as InvoiceStatus)}>{(Object.keys(INVOICE_STATUS_LABELS) as InvoiceStatus[]).map((s) => <option key={s} value={s}>{INVOICE_STATUS_LABELS[s]}</option>)}</Select></Field>
        <Field label="Data do pagamento"><Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} /></Field>
        <Field label="Observação"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Como foi confirmado" /></Field>
      </div>
      <div className="mt-3 flex justify-end"><Button onClick={() => m.mutate()} disabled={m.isPending || note.length < 5}>Confirmar</Button></div>
    </div>
  );
}

function CollectionPanel({ invoice, onDone, canManage }: { invoice: InvoiceDetail; onDone: () => void; canManage: boolean }) {
  const { data: contacts } = useQuery({ queryKey: ['contacts', invoice.entity.id], queryFn: () => api<Array<{ id: string; name: string; role: string | null; whatsapp: string | null; phone: string | null; email: string | null }>>(`/financeiro/entities/${invoice.entity.id}/contacts`), enabled: canManage });
  const [mode, setMode] = useState<'message' | 'manual'>('message');
  const [channel, setChannel] = useState<'WHATSAPP' | 'EMAIL'>('WHATSAPP');
  const [contactId, setContactId] = useState('');
  const [body, setBody] = useState('');
  const [subject, setSubject] = useState('');
  const [prepared, setPrepared] = useState(false);
  const [resultingStatus, setResultingStatus] = useState<CollectionStatus>('SENT');
  const [nextActionAt, setNextActionAt] = useState('');
  const [response, setResponse] = useState('');
  const [manualLink, setManualLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const prepare = useMutation({
    mutationFn: () => api<{ body: string; subject: string | null; providerConfigured: boolean }>('/financeiro/messages/prepare', { method: 'POST', body: { templateKey: invoice.collectionCase?.attempts.length ? 'INVOICE_COLLECTION_FOLLOWUP' : 'INVOICE_COLLECTION', channel, entityId: invoice.entity.id, contactId, invoiceId: invoice.id } }),
    onSuccess: (r) => { setBody(r.body); setSubject(r.subject ?? ''); setPrepared(true); setError(null); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Erro'),
  });
  const charge = useMutation({
    mutationFn: () => api<{ sent: boolean; manualLink: string | null }>('/financeiro/collections/charge', { method: 'POST', body: { channel, entityId: invoice.entity.id, contactId, invoiceId: invoice.id, subject: subject || null, body, resultingStatus, nextActionAt: nextActionAt || null, templateKey: 'INVOICE_COLLECTION' } }),
    onSuccess: (r) => { setManualLink(r.manualLink); if (r.manualLink) window.open(r.manualLink, '_blank', 'noopener'); setPrepared(false); setBody(''); onDone(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Erro'),
  });
  const manual = useMutation({
    mutationFn: () => api(`/financeiro/collections/invoice/${invoice.id}/attempts`, { method: 'POST', body: { channel, contactId: contactId || null, message: body || null, response: response || null, resultingStatus, nextActionAt: nextActionAt || null } }),
    onSuccess: () => { setBody(''); setResponse(''); onDone(); },
  });

  return (
    <div className="space-y-4">
      {canManage && invoice.status === 'PENDING' && (
        <div className="rounded-md border border-line p-3">
          <div className="mb-2 flex gap-2 text-sm"><button className={mode === 'message' ? 'font-medium text-brand' : 'text-ink-2'} onClick={() => setMode('message')}>Enviar cobrança</button><span className="text-ink-3">|</span><button className={mode === 'manual' ? 'font-medium text-brand' : 'text-ink-2'} onClick={() => setMode('manual')}>Registrar cobrança feita</button></div>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Canal"><Select value={channel} onChange={(e) => setChannel(e.target.value as 'WHATSAPP' | 'EMAIL')}><option value="WHATSAPP">WhatsApp</option><option value="EMAIL">E-mail</option>{mode === 'manual' && <><option value="PHONE">Telefone</option><option value="IN_PERSON">Presencial</option></>}</Select></Field>
            <Field label="Contato"><Select value={contactId} onChange={(e) => { setContactId(e.target.value); setPrepared(false); }}><option value="">Selecione</option>{contacts?.map((c) => <option key={c.id} value={c.id}>{c.name}{c.role ? ` — ${c.role}` : ''}</option>)}</Select></Field>
            <Field label="Resultado"><Select value={resultingStatus} onChange={(e) => setResultingStatus(e.target.value as CollectionStatus)}>{COLLECTION_STATUSES.filter((s) => s !== 'SETTLED').map((s) => <option key={s} value={s}>{COLLECTION_STATUS_LABELS[s]}</option>)}</Select></Field>
            {mode === 'message' && !prepared && <div className="md:col-span-3"><Button variant="secondary" onClick={() => prepare.mutate()} disabled={!contactId || prepare.isPending}>Pré-preencher mensagem</Button></div>}
            {(mode === 'manual' || prepared) && (
              <>
                {channel === 'EMAIL' && mode === 'message' && <Field label="Assunto" className="md:col-span-3"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>}
                <Field label="Mensagem" className="md:col-span-3"><Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
                {mode === 'manual' && <Field label="Retorno do cliente" className="md:col-span-2"><Input value={response} onChange={(e) => setResponse(e.target.value)} /></Field>}
                <Field label="Próxima ação em"><Input type="date" value={nextActionAt} onChange={(e) => setNextActionAt(e.target.value)} /></Field>
                <div className="md:col-span-3 flex justify-end gap-2">
                  {mode === 'message' ? <Button onClick={() => charge.mutate()} disabled={charge.isPending || !body}>Confirmar envio</Button> : <Button onClick={() => manual.mutate()} disabled={manual.isPending}>Registrar</Button>}
                </div>
              </>
            )}
          </div>
          {manualLink && <p className="mt-2 text-xs text-ink-2">Provedor não configurado: a mensagem foi aberta para envio manual. <a className="text-brand underline" href={manualLink} target="_blank" rel="noopener">Abrir novamente</a>. O registro só será marcado como enviado após sua confirmação no histórico de mensagens.</p>}
          {error && <p className="mt-2 text-sm text-critical">{error}</p>}
        </div>
      )}
      <ul className="divide-y divide-line text-sm">
        {(invoice.collectionCase?.attempts ?? []).length === 0 && <li className="py-3 text-ink-3">Nenhuma cobrança registrada.</li>}
        {invoice.collectionCase?.attempts.map((a) => (
          <li key={a.id} className="py-2">
            <div className="flex items-center gap-2"><CollectionStatusBadge status={a.resultingStatus} /><span className="text-xs text-ink-3">{formatBrDateTime(a.performedAt)} · {MESSAGE_CHANNEL_LABELS[a.channel as keyof typeof MESSAGE_CHANNEL_LABELS] ?? a.channel}{a.contact ? ` · ${a.contact.name}` : ''}{a.performedBy ? ` · por ${a.performedBy.name}` : ''}</span></div>
            {a.message && <div className="mt-1 whitespace-pre-wrap text-ink-2">{a.message}</div>}
            {a.response && <div className="mt-1 text-ink-2"><strong>Retorno:</strong> {a.response}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}
