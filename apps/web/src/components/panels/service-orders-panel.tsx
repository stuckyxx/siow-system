'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { MONTH_NAMES_PT, SERVICE_ORDER_STATUSES, SERVICE_ORDER_STATUS_LABELS, formatBrDate, formatCompetence, type ServiceOrderStatus } from '@siow/shared';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ServiceOrderStatusBadge } from '../status';
import { Button, Card, Dialog, Empty, Field, Input, Select, Table, Td, Th, Textarea } from '../ui';

interface SORow {
  id: string; competenceMonth: number; competenceYear: number; number: string | null; status: ServiceOrderStatus; requestedAt: string | null; issuedAt: string | null; signedAt: string | null; notes: string | null;
  entity: { id: string; name: string; shortName: string | null }; contract: { id: string; number: string }; document: { id: string; name: string } | null; signedDocument: { id: string; name: string } | null;
  signatories: Array<{ id: string; name: string; role: string | null }>;
}

export function ServiceOrdersPanel({ entityId, contracts }: { entityId?: string; contracts?: Array<{ id: string; number: string }> }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [notify, setNotify] = useState<SORow | null>(null);
  const [sign, setSign] = useState<SORow | null>(null);
  const { data } = useQuery({ queryKey: ['service-orders', entityId], queryFn: () => api<SORow[]>('/financeiro/service-orders', { query: { entityId } }) });
  const setStatus = useMutation({ mutationFn: (v: { id: string; status: ServiceOrderStatus }) => api(`/financeiro/service-orders/${v.id}`, { method: 'PATCH', body: { status: v.status } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['service-orders'] }) });
  const download = async (docId: string): Promise<void> => { const r = await api<{ url: string }>(`/documents/${docId}/download-url`); window.open(r.url, '_blank', 'noopener'); };

  return (
    <div className="space-y-3">
      {entityId && can('service_orders.manage') && <div className="flex justify-end"><Button onClick={() => setCreating(true)}>Nova ordem de serviço</Button></div>}
      <Card>
        {!data ? <div className="p-4 text-sm text-ink-3">Carregando…</div> : data.length === 0 ? <div className="p-4"><Empty>Nenhuma ordem de serviço</Empty></div> : (
          <Table>
            <thead><tr>{!entityId && <Th>Entidade</Th>}<Th>Competência</Th><Th>Contrato</Th><Th>Número</Th><Th>Situação</Th><Th>Solicitada</Th><Th>Emitida</Th><Th>Assinada</Th><Th></Th></tr></thead>
            <tbody>
              {data.map((so) => (
                <tr key={so.id} className="hover:bg-surface">
                  {!entityId && <Td><Link href={`/financeiro/entidades/${so.entity.id}`} className="hover:underline">{so.entity.shortName ?? so.entity.name}</Link></Td>}
                  <Td className="tabular-nums font-medium">{formatCompetence({ competenceMonth: so.competenceMonth, competenceYear: so.competenceYear })}</Td>
                  <Td className="text-ink-2">{so.contract.number}</Td>
                  <Td>{so.number ?? '—'}</Td>
                  <Td>{can('service_orders.manage') ? <Select value={so.status} onChange={(e) => setStatus.mutate({ id: so.id, status: e.target.value as ServiceOrderStatus })} className="w-48">{SERVICE_ORDER_STATUSES.map((s) => <option key={s} value={s}>{SERVICE_ORDER_STATUS_LABELS[s]}</option>)}</Select> : <ServiceOrderStatusBadge status={so.status} />}</Td>
                  <Td className="tabular-nums">{formatBrDate(so.requestedAt)}</Td>
                  <Td className="tabular-nums">{formatBrDate(so.issuedAt)}{so.document && <button className="ml-1 text-xs text-brand" onClick={() => download(so.document!.id)}>PDF</button>}</Td>
                  <Td className="tabular-nums">{formatBrDate(so.signedAt)}{so.signedDocument && <button className="ml-1 text-xs text-brand" onClick={() => download(so.signedDocument!.id)}>assinada</button>}{so.signatories.length > 0 && <div className="text-xs text-ink-3">{so.signatories.map((s) => s.name).join(', ')}</div>}</Td>
                  <Td className="whitespace-nowrap">
                    {can('collections.manage') && ['NOT_REQUESTED', 'REQUESTED', 'AWAITING_ISSUE'].includes(so.status) && <Button size="sm" variant="secondary" onClick={() => setNotify(so)}>Avisar cliente</Button>}
                    {can('service_orders.manage') && so.status !== 'SIGNED' && so.status !== 'CANCELLED' && <Button size="sm" variant="ghost" onClick={() => setSign(so)}>Registrar assinatura</Button>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {entityId && <SOForm open={creating} entityId={entityId} contracts={contracts ?? []} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); qc.invalidateQueries({ queryKey: ['service-orders'] }); }} />}
      <NotifyDialog so={notify} onClose={() => setNotify(null)} onDone={() => { setNotify(null); qc.invalidateQueries({ queryKey: ['service-orders'] }); }} />
      <SignDialog so={sign} onClose={() => setSign(null)} onDone={() => { setSign(null); qc.invalidateQueries({ queryKey: ['service-orders'] }); }} />
    </div>
  );
}

function SOForm({ open, entityId, contracts, onClose, onSaved }: { open: boolean; entityId: string; contracts: Array<{ id: string; number: string }>; onClose: () => void; onSaved: () => void }) {
  const now = new Date();
  const [f, setF] = useState({ contractId: contracts[0]?.id ?? '', competenceMonth: String(now.getMonth() + 1), competenceYear: String(now.getFullYear()), number: '', status: 'NOT_REQUESTED', notes: '' });
  const m = useMutation({ mutationFn: () => api('/financeiro/service-orders', { method: 'POST', body: { entityId, contractId: f.contractId, competenceMonth: Number(f.competenceMonth), competenceYear: Number(f.competenceYear), number: f.number || null, status: f.status, notes: f.notes || null } }), onSuccess: onSaved });
  const b = (k: keyof typeof f) => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }) });
  return (
    <Dialog open={open} onClose={onClose} title="Nova ordem de serviço">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Contrato"><Select {...b('contractId')}>{contracts.map((c) => <option key={c.id} value={c.id}>{c.number}</option>)}</Select></Field>
        <Field label="Situação"><Select {...b('status')}>{SERVICE_ORDER_STATUSES.map((s) => <option key={s} value={s}>{SERVICE_ORDER_STATUS_LABELS[s]}</option>)}</Select></Field>
        <Field label="Mês"><Select {...b('competenceMonth')}>{MONTH_NAMES_PT.map((mn, i) => <option key={mn} value={i + 1}>{mn}</option>)}</Select></Field>
        <Field label="Exercício"><Input {...b('competenceYear')} /></Field>
        <Field label="Número (se houver)"><Input {...b('number')} /></Field>
        <Field label="Observações" className="md:col-span-2"><Textarea rows={2} {...b('notes')} /></Field>
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => m.mutate()} disabled={m.isPending || !f.contractId}>Salvar</Button></div>
    </Dialog>
  );
}

/** "AVISAR CLIENTE PARA EMISSÃO DA ORDEM" (spec §18/§20): contato → canal → mensagem pré-preenchida → editar → confirmar. */
function NotifyDialog({ so, onClose, onDone }: { so: SORow | null; onClose: () => void; onDone: () => void }) {
  const { data: contacts } = useQuery({ queryKey: ['contacts', so?.entity.id], queryFn: () => api<Array<{ id: string; name: string; role: string | null }>>(`/financeiro/entities/${so!.entity.id}/contacts`), enabled: Boolean(so) });
  const [contactId, setContactId] = useState('');
  const [channel, setChannel] = useState<'WHATSAPP' | 'EMAIL'>('WHATSAPP');
  const [body, setBody] = useState('');
  const [subject, setSubject] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const prepare = useMutation({ mutationFn: () => api<{ body: string; subject: string | null }>('/financeiro/messages/prepare', { method: 'POST', body: { templateKey: 'SERVICE_ORDER_ISSUE_REMINDER', channel, entityId: so!.entity.id, contactId, serviceOrderId: so!.id } }), onSuccess: (r) => { setBody(r.body); setSubject(r.subject ?? ''); setError(null); }, onError: (e) => setError(e instanceof ApiError ? e.message : 'Erro') });
  const send = useMutation({
    mutationFn: async () => {
      const r = await api<{ sent: boolean; manualLink: string | null }>('/financeiro/messages/send', { method: 'POST', body: { channel, entityId: so!.entity.id, contactId, serviceOrderId: so!.id, templateKey: 'SERVICE_ORDER_ISSUE_REMINDER', subject: subject || null, body } });
      if (so!.status === 'NOT_REQUESTED') await api(`/financeiro/service-orders/${so!.id}`, { method: 'PATCH', body: { status: 'REQUESTED', requestedAt: new Date().toISOString().slice(0, 10), note: `Cliente avisado via ${channel}` } });
      return r;
    },
    onSuccess: (r) => { if (r.manualLink) { setLink(r.manualLink); window.open(r.manualLink, '_blank', 'noopener'); } else onDone(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Erro'),
  });
  return (
    <Dialog open={Boolean(so)} onClose={onClose} title={so ? `Avisar cliente — OS ${formatCompetence({ competenceMonth: so.competenceMonth, competenceYear: so.competenceYear })}` : ''}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Contato"><Select value={contactId} onChange={(e) => setContactId(e.target.value)}><option value="">Selecione</option>{contacts?.map((c) => <option key={c.id} value={c.id}>{c.name}{c.role ? ` — ${c.role}` : ''}</option>)}</Select></Field>
        <Field label="Canal"><Select value={channel} onChange={(e) => setChannel(e.target.value as 'WHATSAPP' | 'EMAIL')}><option value="WHATSAPP">WhatsApp</option><option value="EMAIL">E-mail</option></Select></Field>
        {!body && <div className="md:col-span-2"><Button variant="secondary" onClick={() => prepare.mutate()} disabled={!contactId || prepare.isPending}>Pré-preencher mensagem</Button></div>}
        {body && (
          <>
            {channel === 'EMAIL' && <Field label="Assunto" className="md:col-span-2"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>}
            <Field label="Mensagem (edite se necessário)" className="md:col-span-2"><Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
          </>
        )}
      </div>
      {link && <p className="mt-2 text-xs text-ink-2">Sem provedor configurado: a mensagem foi aberta para envio manual (<a className="text-brand underline" href={link} target="_blank" rel="noopener">abrir novamente</a>). Ela fica registrada como pendente de confirmação.</p>}
      {error && <p className="mt-2 text-sm text-critical">{error}</p>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={link ? onDone : onClose}>{link ? 'Concluir' : 'Cancelar'}</Button>{!link && <Button onClick={() => send.mutate()} disabled={!body || send.isPending}>Confirmar envio</Button>}</div>
    </Dialog>
  );
}

function SignDialog({ so, onClose, onDone }: { so: SORow | null; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [signedAt, setSignedAt] = useState(new Date().toISOString().slice(0, 10));
  const [signer, setSigner] = useState({ name: '', role: '' });
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append('file', file!);
      fd.append('type', 'SERVICE_ORDER_SIGNED');
      fd.append('entityId', so!.entity.id);
      fd.append('serviceOrderId', so!.id);
      const doc = await api<{ id: string }>('/documents', { method: 'POST', formData: fd });
      return api(`/financeiro/service-orders/${so!.id}/signature/manual`, { method: 'POST', body: { signedDocumentId: doc.id, signedAt, signatories: [{ name: signer.name, role: signer.role || undefined }] } });
    },
    onSuccess: onDone,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Erro'),
  });
  return (
    <Dialog open={Boolean(so)} onClose={onClose} title="Registrar OS assinada">
      <p className="mb-3 text-xs text-ink-3">Sem provedor de assinatura eletrônica configurado, o registro é feito por upload da OS assinada; o arquivo recebe checksum e o registro é auditado.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Arquivo assinado (PDF)" className="md:col-span-2"><Input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
        <Field label="Data da assinatura"><Input type="date" value={signedAt} onChange={(e) => setSignedAt(e.target.value)} /></Field>
        <div />
        <Field label="Signatário"><Input value={signer.name} onChange={(e) => setSigner({ ...signer, name: e.target.value })} /></Field>
        <Field label="Cargo"><Input value={signer.role} onChange={(e) => setSigner({ ...signer, role: e.target.value })} /></Field>
      </div>
      {error && <p className="mt-2 text-sm text-critical">{error}</p>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => m.mutate()} disabled={!file || !signer.name || m.isPending}>Registrar</Button></div>
    </Dialog>
  );
}
