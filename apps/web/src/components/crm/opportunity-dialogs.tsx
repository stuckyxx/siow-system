'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { formatBRL, todayIso, type OpportunityRow } from '@siow/shared';
import { api } from '@/lib/api';
import { useAssignees } from '@/components/panels/tasks-panel';
import { Button, Dialog, Field, Input, Select, Textarea } from '@/components/ui';
import { errMsg } from './opportunity-form';

export function useLossReasons(): string[] {
  const { data } = useQuery({ queryKey: ['crm-meta'], queryFn: () => api<{ lossReasons: string[]; stalledDays: number }>('/comercial/meta'), staleTime: 300_000 });
  return data?.lossReasons ?? ['Preço', 'Concorrente', 'Sem orçamento', 'Sem interesse', 'Troca de gestão', 'Licitação perdida', 'Outro'];
}

export function LoseDialog({ open, opportunity, onClose, onDone }: { open: boolean; opportunity: OpportunityRow; onClose: () => void; onDone: (o: OpportunityRow) => void }) {
  const reasons = useLossReasons();
  const [reason, setReason] = useState(reasons[0] ?? 'Outro');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({ mutationFn: () => api<OpportunityRow>(`/comercial/opportunities/${opportunity.id}/lose`, { method: 'POST', body: { reason, notes: notes || null } }), onSuccess: onDone, onError: (e) => setError(errMsg(e)) });
  return (
    <Dialog open={open} onClose={onClose} title="Marcar como perdida">
      <div className="grid gap-3">
        <Field label="Motivo da perda"><Select value={reason} onChange={(e) => setReason(e.target.value)}>{reasons.map((r) => <option key={r} value={r}>{r}</option>)}</Select></Field>
        <Field label="Observações (o que aprendemos?)"><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      {error && <div className="alert crit" style={{ marginTop: 10 }}>{error}</div>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="danger" onClick={() => m.mutate()} disabled={m.isPending}>Confirmar perda</Button></div>
    </Dialog>
  );
}

export function WinDialog({ open, opportunity, onClose, onDone }: { open: boolean; opportunity: OpportunityRow; onClose: () => void; onDone: (o: OpportunityRow) => void }) {
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({ mutationFn: () => api<OpportunityRow>(`/comercial/opportunities/${opportunity.id}/win`, { method: 'POST', body: { notes: notes || null } }), onSuccess: onDone, onError: (e) => setError(errMsg(e)) });
  return (
    <Dialog open={open} onClose={onClose} title="Marcar como ganha">
      <p className="small muted">A oportunidade vai para a etapa "Ganho". O contrato <b>não</b> é criado automaticamente: em seguida use "Formalizar contrato" para iniciar a contratação (em rascunho até você confirmar).</p>
      <Field label="Observações"><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      {error && <div className="alert crit" style={{ marginTop: 10 }}>{error}</div>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => m.mutate()} disabled={m.isPending}>Confirmar ganho</Button></div>
    </Dialog>
  );
}

/** Assistente de formalização: cria o contrato em RASCUNHO (padrão) ou ATIVO quando o usuário confirma a contratação. */
export function FormalizeDialog({ open, opportunity, endpoint, onClose, onDone }: { open: boolean; opportunity: OpportunityRow; endpoint?: string; onClose: () => void; onDone: (r: { contractId: string; status: string }) => void }) {
  const { data: assignees } = useAssignees();
  const year = todayIso().slice(0, 4);
  const [f, setF] = useState({ number: '', object: opportunity.title, monthlyValue: opportunity.monthlyAmount?.replace('.', ',') ?? '', totalValue: opportunity.totalAmount?.replace('.', ',') ?? '', startDate: todayIso(), endDate: '', responsibleUserId: opportunity.owner?.id ?? '', notes: '', activate: false, issuanceDay: '' });
  const [error, setError] = useState<string | null>(null);
  const b = (k: keyof typeof f) => ({ value: String(f[k]), onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }) });
  const m = useMutation({
    mutationFn: () => api<{ contractId: string; status: string }>(endpoint ?? `/comercial/opportunities/${opportunity.id}/formalize`, { method: 'POST', body: { number: f.number, object: f.object || null, monthlyValue: f.monthlyValue || null, totalValue: f.totalValue || null, startDate: f.startDate || null, endDate: f.endDate || null, responsibleUserId: f.responsibleUserId || null, notes: f.notes || null, activate: f.activate, issuanceDay: f.activate && f.issuanceDay ? Number(f.issuanceDay) : null } }),
    onSuccess: onDone, onError: (e) => setError(errMsg(e)),
  });
  return (
    <Dialog open={open} onClose={onClose} title={`Formalizar contrato — ${opportunity.entity.shortName ?? opportunity.entity.name}`} wide>
      <p className="small muted">Valor previsto na oportunidade: {opportunity.monthlyAmount ? `${formatBRL(opportunity.monthlyAmount)}/mês` : ''}{opportunity.totalAmount ? ` · total ${formatBRL(opportunity.totalAmount)}` : ''}. O contrato nasce em <b>rascunho</b>; marque "Contratação confirmada" apenas quando o contrato estiver assinado.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Número do contrato"><Input {...b('number')} placeholder={`001/${year}`} /></Field>
        <Field label="Responsável"><Select {...b('responsibleUserId')}><option value="">—</option>{assignees?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
        <Field label="Objeto" className="md:col-span-2"><Input {...b('object')} /></Field>
        <Field label="Valor mensal (R$)"><Input {...b('monthlyValue')} /></Field>
        <Field label="Valor total (R$)"><Input {...b('totalValue')} /></Field>
        <Field label="Início da vigência"><Input type="date" {...b('startDate')} /></Field>
        <Field label="Fim da vigência"><Input type="date" {...b('endDate')} /></Field>
        <Field label="Observações" className="md:col-span-2"><Textarea rows={2} {...b('notes')} /></Field>
        <label className="row small md:col-span-2" style={{ gap: 6 }}><input type="checkbox" checked={f.activate} onChange={(e) => setF({ ...f, activate: e.target.checked })} /> <b>Contratação confirmada</b> — criar o contrato já ATIVO (entra na receita prevista e no Financeiro)</label>
        {f.activate && <Field label="Dia do mês para emissão da nota (cria o alarme; opcional)"><Input type="number" min={1} max={31} {...b('issuanceDay')} /></Field>}
      </div>
      {error && <div className="alert crit" style={{ marginTop: 10 }}>{error}</div>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => m.mutate()} disabled={m.isPending || !f.number}>{f.activate ? 'Criar contrato ativo' : 'Criar rascunho de contrato'}</Button></div>
    </Dialog>
  );
}
