'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { MONTH_NAMES_PT, type EntitySummary, type Paginated } from '@siow/shared';
import { api, ApiError } from '@/lib/api';
import { Button, Dialog, Field, Input, Select, Textarea } from './ui';

interface EntityWithContracts { id: string; name: string; contracts: Array<{ id: string; number: string; status: string }> }

/**
 * Registro manual de nota fiscal (origem MANUAL, justificativa obrigatória — PROMPT-MESTRE).
 * Usado na aba Notas fiscais da entidade e na tela geral de Notas. A sincronização nunca apaga a nota
 * manual: se o portal trouxer o mesmo número, ela vira conflito para o usuário decidir.
 */
export function NewInvoiceDialog({ open, onClose, entityId, onCreated }: { open: boolean; onClose: () => void; entityId?: string; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const today = new Date();
  const [f, setF] = useState({ entityId: entityId ?? '', contractId: '', number: '', month: String(today.getMonth() + 1), year: String(today.getFullYear()), amount: '', issueDate: '', status: 'PENDING', paidAt: '', description: '', justification: '' });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const { data: entities } = useQuery({ queryKey: ['entities', 'picker'], queryFn: () => api<Paginated<EntitySummary>>('/financeiro/entities', { query: { pageSize: 200, sortBy: 'name', sortDir: 'asc' } }), enabled: open && !entityId });
  const { data: entity } = useQuery({ queryKey: ['entity', f.entityId], queryFn: () => api<EntityWithContracts>(`/financeiro/entities/${f.entityId}`), enabled: open && Boolean(f.entityId) });

  const create = useMutation({
    mutationFn: () => api<{ id: string }>('/financeiro/invoices', {
      method: 'POST',
      body: {
        entityId: f.entityId,
        contractId: f.contractId || null,
        number: f.number.trim(),
        competenceMonth: Number(f.month),
        competenceYear: Number(f.year),
        amount: f.amount.replace(/\./g, '').replace(',', '.'),
        issueDate: f.issueDate || null,
        status: f.status,
        paidAt: f.status === 'PAID' ? f.paidAt || null : null,
        description: f.description.trim() || null,
        justification: f.justification.trim(),
      },
    }),
    onSuccess: (inv) => {
      void qc.invalidateQueries({ queryKey: ['invoices'] });
      void qc.invalidateQueries({ queryKey: ['entity', f.entityId] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      setF((s) => ({ ...s, number: '', amount: '', issueDate: '', paidAt: '', description: '', justification: '' }));
      onCreated(inv.id);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Falha ao registrar a nota'),
  });

  const amountOk = /^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+([.,]\d{1,2})?$/.test(f.amount.trim());
  const valid = f.entityId && f.number.trim() && amountOk && f.justification.trim().length >= 10 && (f.status !== 'PAID' || f.paidAt);
  const years = Array.from({ length: 8 }, (_, i) => today.getFullYear() + 1 - i);

  return (
    <Dialog open={open} onClose={onClose} title="Registrar nota fiscal" wide>
      <form className="frm" onSubmit={(e) => { e.preventDefault(); setError(null); create.mutate(); }}>
        {!entityId && (
          <Field label="Entidade" className="w">
            <Select value={f.entityId} onChange={(e) => setF((s) => ({ ...s, entityId: e.target.value, contractId: '' }))} required>
              <option value="">Selecione…</option>
              {entities?.items.map((en) => <option key={en.id} value={en.id}>{en.shortName ?? en.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Nº da nota"><Input value={f.number} onChange={set('number')} placeholder="ex.: 926" required maxLength={40} /></Field>
        <Field label="Contrato">
          <Select value={f.contractId} onChange={set('contractId')}>
            <option value="">Sem contrato</option>
            {entity?.contracts.map((c) => <option key={c.id} value={c.id}>{c.number}{c.status !== 'ACTIVE' ? ` (${c.status.toLowerCase()})` : ''}</option>)}
          </Select>
        </Field>
        <Field label="Competência (mês)"><Select value={f.month} onChange={set('month')}>{MONTH_NAMES_PT.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select></Field>
        <Field label="Exercício (ano)"><Select value={f.year} onChange={set('year')}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</Select></Field>
        <Field label="Valor (R$)"><Input value={f.amount} onChange={set('amount')} placeholder="1.320,00" inputMode="decimal" required /></Field>
        <Field label="Emissão"><Input type="date" value={f.issueDate} onChange={set('issueDate')} /></Field>
        <Field label="Situação">
          <Select value={f.status} onChange={set('status')}>
            <option value="PENDING">Pendente</option>
            <option value="PAID">Paga</option>
            <option value="CANCELLED">Cancelada</option>
          </Select>
        </Field>
        <Field label="Data do pagamento"><Input type="date" value={f.paidAt} onChange={set('paidAt')} disabled={f.status !== 'PAID'} required={f.status === 'PAID'} /></Field>
        <Field label="Descrição" className="w"><Textarea rows={2} value={f.description} onChange={set('description')} placeholder="Serviço prestado, referência, observações…" maxLength={4000} /></Field>
        <Field label="Justificativa do registro manual (mín. 10 caracteres)" className="w"><Textarea rows={2} value={f.justification} onChange={set('justification')} placeholder="ex.: nota emitida fora do portal; registro para controle de cobrança" required minLength={10} maxLength={2000} /></Field>
        <p className="small muted w" style={{ margin: 0 }}>A nota fica marcada como <strong>manual</strong>. A sincronização não a apaga; se o portal trouxer o mesmo número, o sistema abre um conflito para você decidir qual versão vale.</p>
        {error && <p className="small w" style={{ color: 'var(--crit)', margin: 0 }}>{error}</p>}
        <div className="row w" style={{ justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={!valid || create.isPending}>{create.isPending ? 'Registrando…' : 'Registrar nota'}</Button>
        </div>
      </form>
    </Dialog>
  );
}
