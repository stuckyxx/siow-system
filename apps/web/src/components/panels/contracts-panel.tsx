'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { CONTRACT_STATUSES, CONTRACT_STATUS_LABELS, formatBRL, formatBrDate, formatBrDateTime, type ContractLedger, type ContractStatus } from '@siow/shared';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ContractStatusBadge } from '../status';
import { Badge, Button, Dialog, Empty, Field, Input, Select, Table, Td, Textarea, Th, useToast } from '../ui';

type AmendmentKind = 'TERM' | 'VALUE' | 'MIXED' | 'OBJECT' | 'OTHER';
export interface ContractRow {
  id: string; number: string; object: string | null; status: ContractStatus; monthlyValue: string | null; startDate: string | null; endDate: string | null; origin: string; notes?: string | null;
  amendments: Array<{ id: string; sequence: number; label: string | null; kind: AmendmentKind; newEndDate: string | null; newMonthlyValue: string | null; newObject?: string | null; signedAt: string | null; description: string | null; origin?: string; documentId?: string | null }>;
  entity?: { id: string; name: string; shortName: string | null };
  responsibleUser: { id: string; name: string } | null;
}
interface DocRow { id: string; name: string; capturedAt: string; type: string; blob: { size: number; mimeType: string } }

const KIND_LABEL: Record<AmendmentKind, string> = { TERM: 'Prazo', VALUE: 'Valor', MIXED: 'Prazo e valor', OBJECT: 'Objeto', OTHER: 'Outro' };
const KIND_HINT: Record<AmendmentKind, string> = {
  TERM: 'Aditivo de prazo: informe a nova data de fim. A vigência do contrato passa a ser essa data.',
  VALUE: 'Aditivo de valor: informe o novo valor mensal. A conta corrente passa a usar esse valor.',
  MIXED: 'Prazo e valor: informe a nova vigência e o novo valor mensal.',
  OBJECT: 'Aditivo de objeto: descreva o novo objeto do contrato.',
  OTHER: 'Outro: registre apenas a descrição do aditivo.',
};
const STATE_LABEL: Record<string, string> = { NOT_INVOICED: 'Sem nota', PENDING: 'Pendente', PAID: 'Paga', PARTIAL: 'Parcial', FUTURE: 'Futura' };
const kb = (n: number): string => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const errMsg = (e: unknown): string => (e instanceof ApiError ? `${e.message}${e.issues?.length ? ': ' + e.issues.map((i) => `${i.path} ${i.message}`).join('; ') : ''}` : 'Erro inesperado');

async function openDocument(id: string): Promise<void> {
  const r = await api<{ url: string }>(`/documents/${id}/download-url`);
  window.open(r.url, '_blank', 'noopener');
}

/**
 * Contratos da entidade. Na ficha (`manualOnly`) mostra APENAS os contratos cadastrados manualmente —
 * os períodos lidos do portal ficam internos (notas e receita prevista). Ações: Editar, + Aditivo, Anexar PDF, Excluir.
 */
export function ContractsPanel({ entityId, manualOnly = false }: { entityId?: string; manualOnly?: boolean }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [toast, showToast] = useToast();
  const [ledgerId, setLedgerId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ContractRow | 'new' | null>(null);
  const [amendFor, setAmendFor] = useState<ContractRow | null>(null);
  const [deleting, setDeleting] = useState<ContractRow | null>(null);
  const { data } = useQuery({ queryKey: ['contracts', entityId], queryFn: () => api<ContractRow[]>('/financeiro/contracts', { query: { entityId } }) });
  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: ['contracts'] });
    void qc.invalidateQueries({ queryKey: ['contract-docs'] });
    void qc.invalidateQueries({ queryKey: ['entity', entityId] });
    void qc.invalidateQueries({ queryKey: ['entities'] });
  };
  const rows = (data ?? []).filter((c) => !manualOnly || c.origin === 'MANUAL');
  const write = can('contracts.write');

  return (
    <div>
      {entityId && write && <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 8 }}><button className="btn p" onClick={() => setEditing('new')}>Novo contrato</button></div>}
      {!data ? <div className="muted">Carregando…</div> : rows.length === 0 ? (
        <Empty>{manualOnly ? 'Nenhum contrato cadastrado manualmente. Use "Novo contrato" para registrar o contrato e seus aditivos.' : 'Nenhum contrato'}</Empty>
      ) : (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0, 1fr)' }}>
          {rows.map((c) => (
            <div key={c.id} className="card">
              <div className="hd" style={{ flexWrap: 'wrap' }}>
                <div>
                  {!entityId && <div className="small muted">{c.entity?.shortName ?? c.entity?.name}</div>}
                  <h2>Contrato {c.number} {c.origin === 'SYNC' && <Badge tone="neutral">portal</Badge>}</h2>
                  <div className="small muted">
                    Vigência {formatBrDate(c.startDate)} a {formatBrDate(c.endDate)} · {c.monthlyValue ? `${formatBRL(c.monthlyValue)}/mês` : 'valor mensal não informado'}
                  </div>
                </div>
                <div className="row">
                  <ContractStatusBadge status={c.status} />
                  {!entityId && <button className="btn sm" onClick={() => setLedgerId(c.id)}>Conta corrente</button>}
                  {write && <button className="btn sm" onClick={() => setEditing(c)}>Editar</button>}
                  {write && <button className="btn sm" onClick={() => setAmendFor(c)}>+ Aditivo</button>}
                  {write && can('documents.write') && <AttachPdf contractId={c.id} onDone={(n) => { showToast(`${n} enviado`); invalidate(); }} onError={(m) => showToast(m)} />}
                  {write && <button className="btn sm danger" onClick={() => setDeleting(c)}>Excluir</button>}
                </div>
              </div>
              <div className="bd">
                {c.object && <p className="small" style={{ margin: '0 0 10px', color: 'var(--ink2)' }}>{c.object}</p>}
                <AmendmentsTable contract={c} canWrite={write} onChanged={invalidate} onError={showToast} />
                <ContractDocuments contractId={c.id} canDelete={can('documents.write')} onError={showToast} />
              </div>
            </div>
          ))}
        </div>
      )}
      <LedgerDialog id={ledgerId} onClose={() => setLedgerId(null)} />
      {entityId && <ContractForm contract={editing} entityId={entityId} onClose={() => setEditing(null)} onSaved={(msg) => { setEditing(null); showToast(msg); invalidate(); }} />}
      <AmendmentForm contract={amendFor} onClose={() => setAmendFor(null)} onSaved={() => { setAmendFor(null); showToast('Aditivo registrado — contrato atualizado'); invalidate(); }} />
      <DeleteContract contract={deleting} onClose={() => setDeleting(null)} onDone={() => { setDeleting(null); showToast('Contrato excluído'); invalidate(); }} />
      {toast}
    </div>
  );
}

function AttachPdf({ contractId, onDone, onError }: { contractId: string; onDone: (name: string) => void; onError: (m: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (files: FileList | null): Promise<void> => {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const f of Array.from(files)) {
        if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) { onError(`${f.name}: envie apenas arquivos PDF`); continue; }
        const fd = new FormData();
        fd.append('file', f);
        fd.append('type', 'CONTRACT');
        fd.append('name', f.name);
        await api(`/financeiro/contracts/${contractId}/documents`, { method: 'POST', formData: fd });
        onDone(f.name);
      }
    } catch (e) {
      onError(errMsg(e));
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = '';
    }
  };
  return (
    <>
      <input ref={ref} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => void upload(e.target.files)} />
      <button className="btn sm" onClick={() => ref.current?.click()} disabled={busy}>{busy ? 'Enviando…' : 'Anexar PDF'}</button>
    </>
  );
}

function ContractDocuments({ contractId, canDelete, onError }: { contractId: string; canDelete: boolean; onError: (m: string) => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['contract-docs', contractId], queryFn: () => api<DocRow[]>(`/financeiro/contracts/${contractId}/documents`) });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/documents/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['contract-docs', contractId] }),
    onError: (e) => onError(errMsg(e)),
  });
  if (!data?.length) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div className="small muted" style={{ textTransform: 'uppercase', letterSpacing: '.08em', fontSize: 10.5, marginBottom: 4 }}>Arquivos do contrato</div>
      <ul className="hist">
        {data.map((d) => (
          <li key={d.id} className="row between">
            <span>📄 {d.name} <span className="small muted">· {kb(d.blob.size)} · {formatBrDateTime(d.capturedAt)}</span></span>
            <span className="row">
              <button className="btn sm" onClick={() => void openDocument(d.id).catch((e) => onError(errMsg(e)))}>Abrir</button>
              {canDelete && <button className="btn sm danger" onClick={() => { if (confirm(`Remover o arquivo ${d.name}?`)) remove.mutate(d.id); }}>Remover</button>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AmendmentsTable({ contract, canWrite, onChanged, onError }: { contract: ContractRow; canWrite: boolean; onChanged: () => void; onError: (m: string) => void }) {
  const remove = useMutation({
    mutationFn: (aid: string) => api(`/financeiro/contracts/${contract.id}/amendments/${aid}`, { method: 'DELETE' }),
    onSuccess: onChanged,
    onError: (e) => onError(errMsg(e)),
  });
  if (!contract.amendments.length) return <p className="small muted" style={{ margin: 0 }}>Nenhum aditivo registrado.</p>;
  return (
    <Table>
      <thead><tr><Th>Nº</Th><Th>Tipo</Th><Th>Assinado em</Th><Th>Nova vigência</Th><Th className="r">Novo valor</Th><Th>Descrição</Th><Th>Origem</Th><Th>PDF</Th><Th></Th></tr></thead>
      <tbody>
        {[...contract.amendments].sort((a, b) => a.sequence - b.sequence).map((a) => (
          <tr key={a.id}>
            <Td className="num">{a.label ?? `${a.sequence}º`}</Td>
            <Td>{KIND_LABEL[a.kind] ?? a.kind}</Td>
            <Td className="num">{formatBrDate(a.signedAt)}</Td>
            <Td className="num">{a.newEndDate ? formatBrDate(a.newEndDate) : '—'}</Td>
            <Td className="r num">{a.newMonthlyValue ? formatBRL(a.newMonthlyValue) : '—'}</Td>
            <Td className="small" style={{ maxWidth: 280 }}>{a.newObject ? <><b>Novo objeto:</b> {a.newObject}{a.description ? ' · ' : ''}</> : null}{a.description ?? (a.newObject ? '' : '—')}</Td>
            <Td className="small muted">{a.origin === 'SYNC' ? 'portal' : 'manual'}</Td>
            <Td>{a.documentId ? <button className="btn sm" onClick={() => void openDocument(a.documentId!).catch((e) => onError(errMsg(e)))}>Abrir</button> : <span className="muted">—</span>}</Td>
            <Td>{canWrite && <button className="btn sm danger" onClick={() => { if (confirm(`Excluir o aditivo ${a.label ?? a.sequence}? O contrato volta à vigência/valor do aditivo anterior (ou ao original).`)) remove.mutate(a.id); }}>Excluir</button>}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function LedgerDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data } = useQuery({ queryKey: ['ledger', id], queryFn: () => api<ContractLedger>(`/financeiro/contracts/${id}/ledger`), enabled: Boolean(id) });
  return (
    <Dialog open={Boolean(id)} onClose={onClose} title={data ? `Conta corrente — contrato ${data.contractNumber}` : 'Conta corrente'} wide>
      {!data ? <div className="muted">Carregando…</div> : (
        <div>
          <div className="kv">
            <div><div className="l">Deveria ter sido faturado</div><div className="num">{formatBRL(data.totals.expected)}</div></div>
            <div><div className="l">Faturado</div><div className="num">{formatBRL(data.totals.invoiced)}</div></div>
            <div><div className="l">Pago</div><div className="num" style={{ color: 'var(--good)' }}>{formatBRL(data.totals.paid)}</div></div>
            <div><div className="l">Pendente</div><div className="num" style={{ color: 'var(--warn)' }}>{formatBRL(data.totals.pending)}</div></div>
          </div>
          <Table>
            <thead><tr><Th>Competência</Th><Th className="r">Esperado</Th><Th className="r">Faturado</Th><Th className="r">Pago</Th><Th className="r">Pendente</Th><Th>Notas</Th><Th>Situação</Th></tr></thead>
            <tbody>
              {data.months.map((m) => (
                <tr key={m.competence}>
                  <Td className="num">{m.competence.split('-').reverse().join('/')}</Td>
                  <Td className="r num">{formatBRL(m.expected)}</Td>
                  <Td className="r num">{formatBRL(m.invoiced)}</Td>
                  <Td className="r num">{formatBRL(m.paid)}</Td>
                  <Td className="r num">{formatBRL(m.pending)}</Td>
                  <Td>{m.invoiceCount}</Td>
                  <Td><Badge tone={m.state === 'PAID' ? 'good' : m.state === 'PENDING' || m.state === 'PARTIAL' ? 'warn' : m.state === 'NOT_INVOICED' ? 'critical' : 'neutral'}>{STATE_LABEL[m.state]}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Dialog>
  );
}

function ContractForm({ contract, entityId, onClose, onSaved }: { contract: ContractRow | 'new' | null; entityId: string; onClose: () => void; onSaved: (msg: string) => void }) {
  const editing = contract && contract !== 'new' ? contract : null;
  const blank = { number: '', object: '', monthlyValue: '', startDate: '', endDate: '', status: 'ACTIVE', notes: '' };
  const [f, setF] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const key = contract === 'new' ? 'new' : contract?.id ?? null;
  if (key !== lastKey) {
    setLastKey(key);
    setError(null);
    setF(editing ? { number: editing.number, object: editing.object ?? '', monthlyValue: editing.monthlyValue ?? '', startDate: editing.startDate ?? '', endDate: editing.endDate ?? '', status: editing.status, notes: editing.notes ?? '' } : blank);
  }
  const m = useMutation({
    mutationFn: () => {
      const body = { number: f.number.trim(), object: f.object || null, monthlyValue: f.monthlyValue ? f.monthlyValue.replace(',', '.') : null, startDate: f.startDate || null, endDate: f.endDate || null, status: f.status as ContractStatus, notes: f.notes || null };
      return editing ? api(`/financeiro/contracts/${editing.id}`, { method: 'PATCH', body }) : api('/financeiro/contracts', { method: 'POST', body: { entityId, ...body } });
    },
    onSuccess: () => {
      const ended = f.status !== 'ACTIVE' || (f.endDate && f.endDate < new Date().toISOString().slice(0, 10));
      onSaved(editing ? (ended ? 'Contrato salvo — encerrado, a entidade sai da lista de ativas' : 'Contrato atualizado') : 'Contrato cadastrado');
    },
    onError: (e) => setError(errMsg(e)),
  });
  const b = (k: keyof typeof f) => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }) });
  const submit = (): void => {
    if (!f.number.trim()) return setError('Informe o número do contrato');
    if (f.startDate && f.endDate && f.endDate < f.startDate) return setError('A data de fim não pode ser anterior ao início');
    if (f.monthlyValue && !/^\d+([.,]\d{1,2})?$/.test(f.monthlyValue)) return setError('Valor mensal inválido (ex.: 1320,00)');
    setError(null);
    m.mutate();
  };
  return (
    <Dialog open={Boolean(contract)} onClose={onClose} title={editing ? `Editar contrato ${editing.number}` : 'Novo contrato'}>
      <div className="frm">
        <Field label="Número"><Input {...b('number')} placeholder="070201001/2025" /></Field>
        <Field label="Situação"><Select {...b('status')}>{CONTRACT_STATUSES.map((s) => <option key={s} value={s}>{CONTRACT_STATUS_LABELS[s]}</option>)}</Select></Field>
        <Field label="Início"><Input type="date" {...b('startDate')} /></Field>
        <Field label="Fim"><Input type="date" {...b('endDate')} /></Field>
        <Field label="Valor mensal (R$)"><Input {...b('monthlyValue')} placeholder="1320,00" inputMode="decimal" /></Field>
        <div />
        <Field label="Objeto" className="w"><Textarea rows={2} {...b('object')} /></Field>
        <Field label="Observações" className="w"><Textarea rows={2} {...b('notes')} /></Field>
      </div>
      {editing && <p className="small muted">Com data de fim passada ou situação diferente de "Ativo", a entidade sai da lista de ativas.</p>}
      {error && <div className="alert crit" style={{ marginTop: 10 }}>{error}</div>}
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={submit} disabled={m.isPending}>Salvar</Button></div>
    </Dialog>
  );
}

function AmendmentForm({ contract, onClose, onSaved }: { contract: ContractRow | null; onClose: () => void; onSaved: () => void }) {
  const blank = { label: '', kind: 'TERM' as AmendmentKind, newEndDate: '', newMonthlyValue: '', newObject: '', signedAt: '', effectiveFrom: '', description: '' };
  const [f, setF] = useState(blank);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastId, setLastId] = useState<string | null>(null);
  if ((contract?.id ?? null) !== lastId) {
    setLastId(contract?.id ?? null);
    setError(null);
    setFile(null);
    setF({ ...blank, label: contract ? `${contract.amendments.length + 1}º ADT` : '', newEndDate: contract?.endDate ?? '', newObject: contract?.object ?? '' });
  }
  const term = f.kind === 'TERM' || f.kind === 'MIXED';
  const value = f.kind === 'VALUE' || f.kind === 'MIXED';
  const object = f.kind === 'OBJECT';
  const m = useMutation({
    mutationFn: async () => {
      let documentId: string | null = null;
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('type', 'CONTRACT');
        fd.append('name', `${f.label || 'Aditivo'} — ${file.name}`);
        documentId = (await api<{ id: string }>(`/financeiro/contracts/${contract!.id}/documents`, { method: 'POST', formData: fd })).id;
      }
      return api(`/financeiro/contracts/${contract!.id}/amendments`, {
        method: 'POST',
        body: {
          label: f.label || null, kind: f.kind, signedAt: f.signedAt || null, effectiveFrom: f.effectiveFrom || null, description: f.description || null, documentId,
          newEndDate: term ? f.newEndDate : null, newMonthlyValue: value ? f.newMonthlyValue.replace(',', '.') : null, newObject: object ? f.newObject : null,
        },
      });
    },
    onSuccess: onSaved,
    onError: (e) => setError(errMsg(e)),
  });
  const b = (k: keyof typeof f) => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }) });
  const submit = (): void => {
    if (term && !f.newEndDate) return setError('Informe a nova vigência (fim)');
    if (value && !/^\d+([.,]\d{1,2})?$/.test(f.newMonthlyValue)) return setError('Informe o novo valor mensal (ex.: 1450,00)');
    if (object && f.newObject.trim().length < 3) return setError('Descreva o novo objeto do contrato');
    if (f.kind === 'OTHER' && f.description.trim().length < 3) return setError('Descreva o aditivo');
    if (file && file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) return setError('O arquivo do aditivo precisa ser PDF');
    setError(null);
    m.mutate();
  };
  return (
    <Dialog open={Boolean(contract)} onClose={onClose} title={`Novo aditivo — contrato ${contract?.number ?? ''}`}>
      <div className="frm">
        <Field label="Identificação"><Input {...b('label')} /></Field>
        <Field label="Tipo">
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as AmendmentKind })}>
            {(Object.keys(KIND_LABEL) as AmendmentKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </Select>
        </Field>
        <Field label="Assinado em"><Input type="date" {...b('signedAt')} /></Field>
        <Field label="Vigora a partir de"><Input type="date" {...b('effectiveFrom')} /></Field>
        {term && <Field label="Nova vigência (fim)"><Input type="date" {...b('newEndDate')} /></Field>}
        {value && <Field label="Novo valor mensal (R$)"><Input {...b('newMonthlyValue')} placeholder={contract?.monthlyValue ? `atual: ${formatBRL(contract.monthlyValue)}` : '0,00'} inputMode="decimal" /></Field>}
        {object && <Field label="Novo objeto do contrato" className="w"><Textarea rows={2} {...b('newObject')} /></Field>}
        <Field label={f.kind === 'OTHER' ? 'Descrição do aditivo' : 'Descrição / justificativa'} className="w"><Textarea rows={2} {...b('description')} /></Field>
        <Field label="Arquivo do aditivo (PDF, opcional)" className="w"><input type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
      </div>
      <p className="small muted">{KIND_HINT[f.kind]}</p>
      {error && <div className="alert crit">{error}</div>}
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={submit} disabled={m.isPending}>{m.isPending ? 'Salvando…' : 'Salvar aditivo'}</Button></div>
    </Dialog>
  );
}

function DeleteContract({ contract, onClose, onDone }: { contract: ContractRow | null; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({ mutationFn: () => api(`/financeiro/contracts/${contract!.id}`, { method: 'DELETE' }), onSuccess: () => { setError(null); onDone(); }, onError: (e) => setError(errMsg(e)) });
  const n = contract?.amendments.length ?? 0;
  return (
    <Dialog open={Boolean(contract)} onClose={onClose} title="Excluir contrato">
      <p>Excluir o contrato <b>{contract?.number}</b>{n ? ` e seus ${n} aditivo(s)` : ''}? A exclusão fica registrada na auditoria.</p>
      {error && <div className="alert crit">{error}</div>}
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="danger" onClick={() => m.mutate()} disabled={m.isPending}>Excluir</Button></div>
    </Dialog>
  );
}
