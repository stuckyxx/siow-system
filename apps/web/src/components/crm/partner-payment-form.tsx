'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { formatBRL, todayIso, type PartnerRow, type PartnerStatement } from '@siow/shared';
import { api } from '@/lib/api';
import { Button, Dialog, Field, Input, Select, Textarea } from '@/components/ui';
import { errMsg } from './partner-form';

/** Formulário de pagamento feito pelo parceiro (aba Pagamentos do parceiro). */
export function PaymentForm({ partnerId, entities, onClose, onSaved, title }: { partnerId: string; entities: PartnerStatement['entities']; onClose: () => void; onSaved: () => void; title?: string }) {
  const today = todayIso();
  const total = entities.reduce((a, e) => a + Number(e.monthlyValue ?? 0), 0).toFixed(2);
  const [f, setF] = useState({ entityId: '', competence: today.slice(0, 7), amount: total.replace('.', ','), paidAt: today, notes: '' });
  const [error, setError] = useState<string | null>(null);
  const pickEntity = (entityId: string): void => { const e = entities.find((x) => x.id === entityId); setF({ ...f, entityId, amount: (entityId ? e?.monthlyValue ?? '' : total).replace('.', ',') }); };
  const m = useMutation({ mutationFn: () => api(`/parceiros/${partnerId}/payments`, { method: 'POST', body: { entityId: f.entityId || null, competence: f.competence, amount: f.amount.trim().replace(/\./g, '').replace(',', '.'), paidAt: f.paidAt, notes: f.notes.trim() || null } }), onSuccess: onSaved, onError: (e) => setError(errMsg(e)) });
  return (
    <Dialog open onClose={onClose} title={title ?? 'Registrar pagamento do parceiro'}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Entidade" className="md:col-span-2"><Select value={f.entityId} onChange={(e) => pickEntity(e.target.value)}><option value="">Geral (todas as entidades do parceiro)</option>{entities.map((e) => <option key={e.id} value={e.id}>{e.shortName ?? e.name}{e.monthlyValue ? ` — ${formatBRL(e.monthlyValue)}` : ''}</option>)}</Select></Field>
        <Field label="Competência (mês de referência)"><Input type="month" value={f.competence} onChange={(e) => setF({ ...f, competence: e.target.value })} /></Field>
        <Field label="Valor pago (R$)"><Input value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} inputMode="decimal" placeholder="ex.: 1.500,00" /></Field>
        <Field label="Data do pagamento"><Input type="date" value={f.paidAt} onChange={(e) => setF({ ...f, paidAt: e.target.value })} /></Field>
        <Field label="Observação" className="md:col-span-2"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      {error && <div className="alert crit" style={{ marginTop: 10 }}>{error}</div>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => m.mutate()} disabled={m.isPending || !f.amount.trim() || !f.competence || !f.paidAt}>Salvar</Button></div>
    </Dialog>
  );
}

/** Mesmo formulário a partir da lista de parceiros: escolhe o parceiro e carrega as entidades vinculadas. */
export function PaymentPicker({ partners, onClose, onSaved }: { partners: PartnerRow[]; onClose: () => void; onSaved: () => void }) {
  const [partnerId, setPartnerId] = useState('');
  const { data: st } = useQuery({ queryKey: ['partner-statement', partnerId], queryFn: () => api<PartnerStatement>(`/parceiros/${partnerId}/statement`), enabled: Boolean(partnerId) });
  if (partnerId && st) return <PaymentForm key={partnerId} partnerId={partnerId} entities={st.entities} onClose={onClose} onSaved={onSaved} title={`Registrar pagamento — ${st.partner.name}`} />;
  return (
    <Dialog open onClose={onClose} title="Registrar pagamento do parceiro">
      <Field label="Parceiro"><Select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}><option value="">Escolha o parceiro…</option>{partners.filter((p) => p.isActive).map((p) => <option key={p.id} value={p.id}>{p.name}{Number(p.monthlyTotal) ? ` — ${formatBRL(p.monthlyTotal)}/mês` : ''}</option>)}</Select></Field>
      {partnerId && !st && <div className="small muted" style={{ marginTop: 8 }}>Carregando entidades…</div>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button></div>
    </Dialog>
  );
}
