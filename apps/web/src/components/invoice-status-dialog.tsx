'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { todayIso } from '@siow/shared';
import { api, ApiError } from '@/lib/api';
import { Button, Dialog, Field, Input, Select, Textarea } from './ui';

interface Result { updated: number; skipped: number; errors: Array<{ id: string; number: string | null; error: string }> }

/**
 * Altera a situação (Paga/Pendente) de uma ou várias notas. Sempre manual e com justificativa:
 * a nota fica marcada como "manual" e a sincronização abre conflito se o portal discordar.
 */
export function InvoiceStatusDialog({ ids, label, currentStatus, onClose, onDone }: { ids: string[]; label?: string; currentStatus?: string; onClose: () => void; onDone: (r: Result) => void }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'PAID' | 'PENDING'>(currentStatus === 'PAID' ? 'PENDING' : 'PAID');
  const [paidAt, setPaidAt] = useState(todayIso());
  const [justification, setJustification] = useState('');
  const [error, setError] = useState<string | null>(null);
  const many = ids.length > 1;

  const run = useMutation({
    mutationFn: () => api<Result>('/financeiro/invoices/bulk-status', { method: 'POST', body: { ids, status, paidAt: status === 'PAID' ? paidAt : null, justification: justification.trim() } }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['invoices'] });
      void qc.invalidateQueries({ queryKey: ['entity'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      onDone(r);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Falha ao alterar a situação'),
  });
  const valid = justification.trim().length >= 10 && (status !== 'PAID' || paidAt);

  return (
    <Dialog open={ids.length > 0} onClose={onClose} title={many ? `Alterar situação de ${ids.length} notas` : `Alterar situação${label ? ` — nota ${label}` : ''}`}>
      <form className="frm" onSubmit={(e) => { e.preventDefault(); setError(null); run.mutate(); }}>
        <Field label="Nova situação">
          <Select value={status} onChange={(e) => setStatus(e.target.value as 'PAID' | 'PENDING')}>
            <option value="PAID">Paga</option>
            <option value="PENDING">Pendente</option>
          </Select>
        </Field>
        <Field label="Data do pagamento"><Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} disabled={status !== 'PAID'} required={status === 'PAID'} /></Field>
        <Field label="Justificativa (mín. 10 caracteres)" className="w"><Textarea rows={2} value={justification} onChange={(e) => setJustification(e.target.value)} placeholder={status === 'PAID' ? 'ex.: pagamento confirmado no extrato bancário' : 'ex.: pagamento não localizado; volta a pendente'} required minLength={10} maxLength={2000} /></Field>
        <p className="small muted w" style={{ margin: 0 }}>
          {status === 'PAID' ? 'As notas ficam como pagas com o valor integral e a data informada; cobranças abertas são encerradas.' : 'As notas voltam a pendente e a data de pagamento é apagada.'} A alteração é manual: a sincronização não a desfaz e abre um conflito se o portal discordar.
        </p>
        {error && <p className="small w" style={{ color: 'var(--crit)', margin: 0 }}>{error}</p>}
        <div className="row w" style={{ justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={!valid || run.isPending}>{run.isPending ? 'Aplicando…' : many ? `Aplicar em ${ids.length} notas` : 'Aplicar'}</Button>
        </div>
      </form>
    </Dialog>
  );
}
