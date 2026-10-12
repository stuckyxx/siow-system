'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PROPOSAL_STATUS_LABELS, RECURRENCE_LABELS, formatBRL, formatBrDate, formatBrDateTime, type ProposalRow, type ProposalStatus, type Recurrence } from '@siow/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Dialog, Empty, Field, Input, Textarea, useToast } from '@/components/ui';
import { ItemsEditor, errMsg, useCatalog, type ItemDraft } from './opportunity-form';

const TONE: Record<string, 'neutral' | 'info' | 'good' | 'critical'> = { DRAFT: 'neutral', SENT: 'info', ACCEPTED: 'good', REJECTED: 'critical', SUPERSEDED: 'neutral' };

async function openPdf(id: string): Promise<void> {
  const blob = await api<Blob>(`/comercial/proposals/${id}/pdf`, { raw: true });
  const url = URL.createObjectURL(blob); window.open(url, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Propostas da oportunidade: versões (a mais nova é a vigente), PDF, situação (enviada/aceita/recusada), nova versão a partir da anterior. */
export function ProposalsPanel({ opportunityId, opportunityTitle, items, canEdit }: { opportunityId: string; opportunityTitle: string; items: ItemDraft[]; canEdit: boolean }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [toast, showToast] = useToast();
  const [creating, setCreating] = useState<ProposalRow | 'new' | null>(null);
  const { data } = useQuery({ queryKey: ['proposals', opportunityId], queryFn: () => api<ProposalRow[]>(`/comercial/opportunities/${opportunityId}/proposals`) });
  const status = useMutation({ mutationFn: (v: { id: string; status: string }) => api(`/comercial/proposals/${v.id}/status`, { method: 'POST', body: { status: v.status } }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['proposals', opportunityId] }); void qc.invalidateQueries({ queryKey: ['opportunity', opportunityId] }); }, onError: (e) => showToast(errMsg(e)) });
  return (
    <div>
      <div className="row between" style={{ marginBottom: 8 }}>
        <span className="small muted">Cada nova proposta vira uma versão; as anteriores ficam como "substituída" e continuam consultáveis.</span>
        {canEdit && can('crm.write') && <Button size="sm" onClick={() => setCreating('new')}>+ Nova proposta</Button>}
      </div>
      {!data ? <div className="small muted">Carregando…</div> : data.length === 0 ? <div className="card"><div className="bd"><Empty>Nenhuma proposta ainda</Empty></div></div> : data.map((p) => (
        <div key={p.id} className="card" style={{ marginBottom: 10, opacity: p.status === 'SUPERSEDED' ? 0.7 : 1 }}>
          <div className="hd"><div><b>v{p.version} · {p.title}</b> <Badge tone={TONE[p.status]}>{PROPOSAL_STATUS_LABELS[p.status as ProposalStatus]}</Badge><div className="small muted">criada {formatBrDateTime(p.createdAt)}{p.sentAt ? ` · enviada ${formatBrDateTime(p.sentAt)}` : ''}{p.validUntil ? ` · válida até ${formatBrDate(p.validUntil)}` : ''}</div></div>
            <div className="row">
              <Button size="sm" variant="secondary" onClick={() => void openPdf(p.id)}>PDF</Button>
              {canEdit && can('crm.write') && p.status !== 'SUPERSEDED' && <>
                {p.status === 'DRAFT' && <Button size="sm" variant="secondary" onClick={() => status.mutate({ id: p.id, status: 'SENT' })}>Marcar enviada</Button>}
                {p.status !== 'ACCEPTED' && <Button size="sm" variant="secondary" onClick={() => status.mutate({ id: p.id, status: 'ACCEPTED' })}>Aceita</Button>}
                {p.status !== 'REJECTED' && <Button size="sm" variant="ghost" onClick={() => status.mutate({ id: p.id, status: 'REJECTED' })}>Recusada</Button>}
                <Button size="sm" variant="ghost" onClick={() => setCreating(p)}>Nova versão</Button>
              </>}
            </div>
          </div>
          <div className="bd small">
            <table style={{ width: '100%' }}><tbody>
              {p.items.map((i) => <tr key={i.id}><td>{i.description}</td><td className="r num">{Number(i.quantity).toLocaleString('pt-BR')}</td><td className="r num">{formatBRL(i.unitPrice)}</td><td className="muted">{RECURRENCE_LABELS[i.recurrence as Recurrence] ?? i.recurrence}</td><td className="r num">{formatBRL(i.total)}</td></tr>)}
            </tbody></table>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 14, marginTop: 6 }}>{Number(p.totalMonthly) > 0 && <b>Mensal {formatBRL(p.totalMonthly)}</b>}{Number(p.totalOneTime) > 0 && <b>Único {formatBRL(p.totalOneTime)}</b>}</div>
          </div>
        </div>
      ))}
      {creating && <ProposalForm opportunityId={opportunityId} base={creating === 'new' ? null : creating} defaultTitle={opportunityTitle} defaultItems={items} onClose={() => setCreating(null)} onSaved={() => { setCreating(null); void qc.invalidateQueries({ queryKey: ['proposals', opportunityId] }); void qc.invalidateQueries({ queryKey: ['opportunity', opportunityId] }); showToast('Proposta criada'); }} />}
      {toast}
    </div>
  );
}

function ProposalForm({ opportunityId, base, defaultTitle, defaultItems, onClose, onSaved }: { opportunityId: string; base: ProposalRow | null; defaultTitle: string; defaultItems: ItemDraft[]; onClose: () => void; onSaved: () => void }) {
  const catalog = useCatalog();
  const [f, setF] = useState({ title: base?.title ?? `Proposta — ${defaultTitle}`, validUntil: base?.validUntil ?? '', introduction: base?.introduction ?? '', terms: base?.terms ?? 'Valores válidos pelo prazo indicado. Faturamento mensal mediante emissão de nota fiscal. Reajuste anual pelo índice contratual.', notes: base?.notes ?? '' });
  const [items, setItems] = useState<ItemDraft[]>(base ? base.items.map((i) => ({ catalogItemId: null, description: i.description, quantity: i.quantity.replace('.', ','), unitPrice: i.unitPrice.replace('.', ','), recurrence: i.recurrence })) : defaultItems.length ? defaultItems : [{ catalogItemId: null, description: '', quantity: '1', unitPrice: '', recurrence: 'MONTHLY' }]);
  const [error, setError] = useState<string | null>(null);
  const b = (k: keyof typeof f) => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }) });
  const m = useMutation({ mutationFn: () => api(`/comercial/opportunities/${opportunityId}/proposals`, { method: 'POST', body: { ...f, validUntil: f.validUntil || null, introduction: f.introduction || null, terms: f.terms || null, notes: f.notes || null, items: items.map((it) => ({ description: it.description, quantity: it.quantity, unitPrice: it.unitPrice, recurrence: it.recurrence })) } }), onSuccess: onSaved, onError: (e) => setError(errMsg(e)) });
  return (
    <Dialog open onClose={onClose} title={base ? `Nova versão (a partir da v${base.version})` : 'Nova proposta'} wide>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Título"><Input {...b('title')} /></Field>
        <Field label="Válida até"><Input type="date" {...b('validUntil')} /></Field>
        <Field label="Apresentação (texto inicial do PDF)" className="md:col-span-2"><Textarea rows={3} {...b('introduction')} placeholder="Apresentamos a proposta para…" /></Field>
        <ItemsEditor items={items} onChange={setItems} catalog={catalog} />
        <Field label="Condições" className="md:col-span-2"><Textarea rows={3} {...b('terms')} /></Field>
        <Field label="Observações" className="md:col-span-2"><Textarea rows={2} {...b('notes')} /></Field>
      </div>
      {error && <div className="alert crit" style={{ marginTop: 10 }}>{error}</div>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => m.mutate()} disabled={m.isPending || items.length === 0 || items.some((i) => !i.description || !i.unitPrice)}>{m.isPending ? 'Gerando…' : 'Criar proposta'}</Button></div>
    </Dialog>
  );
}
