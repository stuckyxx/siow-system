'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CONTRACT_STATUSES, CONTRACT_STATUS_LABELS, formatBRL, formatBrDate, type ContractLedger, type ContractStatus } from '@siow/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ContractStatusBadge } from '../status';
import { Badge, Button, Card, Dialog, Empty, Field, Input, Select, Table, Td, Th, Textarea } from '../ui';

export interface ContractRow {
  id: string; number: string; object: string | null; status: ContractStatus; monthlyValue: string | null; startDate: string | null; endDate: string | null; origin: string;
  amendments: Array<{ id: string; sequence: number; label: string | null; kind: string; newEndDate: string | null; newMonthlyValue: string | null; signedAt: string | null; description: string | null }>;
  entity?: { id: string; name: string; shortName: string | null };
  responsibleUser: { id: string; name: string } | null;
}

const STATE_LABEL: Record<string, string> = { NOT_INVOICED: 'Sem nota', PENDING: 'Pendente', PAID: 'Paga', PARTIAL: 'Parcial', FUTURE: 'Futura' };

export function ContractsPanel({ entityId }: { entityId?: string }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [ledgerId, setLedgerId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [amendFor, setAmendFor] = useState<ContractRow | null>(null);
  const { data } = useQuery({ queryKey: ['contracts', entityId], queryFn: () => api<ContractRow[]>('/financeiro/contracts', { query: { entityId } }) });
  const invalidate = (): void => { qc.invalidateQueries({ queryKey: ['contracts'] }); qc.invalidateQueries({ queryKey: ['entity', entityId] }); };

  return (
    <div className="space-y-3">
      {entityId && can('contracts.write') && <div className="flex justify-end"><Button onClick={() => setCreating(true)}>Novo contrato</Button></div>}
      <Card>
        {!data ? <div className="p-6 text-sm text-ink-3">Carregando…</div> : data.length === 0 ? <div className="p-6"><Empty>Nenhum contrato</Empty></div> : (
          <Table>
            <thead><tr>{!entityId && <Th>Entidade</Th>}<Th>Número</Th><Th>Objeto</Th><Th className="text-right">Valor mensal</Th><Th>Vigência</Th><Th>Aditivos</Th><Th>Situação</Th><Th>Responsável</Th><Th></Th></tr></thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="hover:bg-surface">
                  {!entityId && <Td>{c.entity?.shortName ?? c.entity?.name}</Td>}
                  <Td className="font-medium">{c.number}{c.origin === 'SYNC' && <Badge tone="neutral" className="ml-1">portal</Badge>}</Td>
                  <Td className="max-w-xs truncate text-ink-2">{c.object ?? '—'}</Td>
                  <Td className="text-right tabular-nums">{c.monthlyValue ? formatBRL(c.monthlyValue) : '—'}</Td>
                  <Td className="tabular-nums">{formatBrDate(c.startDate)} – {formatBrDate(c.endDate)}</Td>
                  <Td>{c.amendments.length ? c.amendments.map((a) => a.label ?? `${a.sequence}º`).join(', ') : '—'}</Td>
                  <Td><ContractStatusBadge status={c.status} /></Td>
                  <Td className="text-ink-2">{c.responsibleUser?.name ?? '—'}</Td>
                  <Td className="whitespace-nowrap"><Button size="sm" variant="ghost" onClick={() => setLedgerId(c.id)}>Conta corrente</Button>{can('contracts.write') && <Button size="sm" variant="ghost" onClick={() => setAmendFor(c)}>Aditivo</Button>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <LedgerDialog id={ledgerId} onClose={() => setLedgerId(null)} />
      {entityId && <ContractForm open={creating} entityId={entityId} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); invalidate(); }} />}
      <AmendmentForm contract={amendFor} onClose={() => setAmendFor(null)} onSaved={() => { setAmendFor(null); invalidate(); }} />
    </div>
  );
}

function LedgerDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data } = useQuery({ queryKey: ['ledger', id], queryFn: () => api<ContractLedger>(`/financeiro/contracts/${id}/ledger`), enabled: Boolean(id) });
  return (
    <Dialog open={Boolean(id)} onClose={onClose} title={data ? `Conta corrente — contrato ${data.contractNumber}` : 'Conta corrente'} wide>
      {!data ? <div className="text-sm text-ink-3">Carregando…</div> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <div><div className="text-xs text-ink-3">Deveria ter sido faturado</div><div className="font-medium tabular-nums">{formatBRL(data.totals.expected)}</div></div>
            <div><div className="text-xs text-ink-3">Faturado</div><div className="font-medium tabular-nums">{formatBRL(data.totals.invoiced)}</div></div>
            <div><div className="text-xs text-ink-3">Pago</div><div className="font-medium tabular-nums text-good">{formatBRL(data.totals.paid)}</div></div>
            <div><div className="text-xs text-ink-3">Pendente</div><div className="font-medium tabular-nums text-warn">{formatBRL(data.totals.pending)}</div></div>
            <div><div className="text-xs text-ink-3">Competências sem nota</div><div className="font-medium">{data.totals.monthsNotInvoiced}</div></div>
            <div><div className="text-xs text-ink-3">Competências pendentes</div><div className="font-medium">{data.totals.monthsPending}</div></div>
            <div><div className="text-xs text-ink-3">Pagamento mais recente</div><div className="font-medium">{data.totals.lastPaymentAt ? `${formatBrDate(data.totals.lastPaymentAt)} · ${formatBRL(data.totals.lastPaymentAmount)}` : '—'}</div></div>
            <div><div className="text-xs text-ink-3">Valor mensal</div><div className="font-medium">{data.monthlyValue ? formatBRL(data.monthlyValue) : 'não informado'}</div></div>
          </div>
          {!data.monthlyValue && <p className="text-xs text-ink-3">Informe o valor mensal do contrato para o sistema apontar competências sem faturamento.</p>}
          <Table>
            <thead><tr><Th>Competência</Th><Th className="text-right">Esperado</Th><Th className="text-right">Faturado</Th><Th className="text-right">Pago</Th><Th className="text-right">Pendente</Th><Th>Notas</Th><Th>Situação</Th></tr></thead>
            <tbody>
              {data.months.map((m) => (
                <tr key={m.competence} className={m.state === 'NOT_INVOICED' && Number(m.expected) > 0 ? 'bg-red-50' : ''}>
                  <Td className="tabular-nums">{m.competence.split('-').reverse().join('/')}</Td>
                  <Td className="text-right tabular-nums">{formatBRL(m.expected)}</Td>
                  <Td className="text-right tabular-nums">{formatBRL(m.invoiced)}</Td>
                  <Td className="text-right tabular-nums">{formatBRL(m.paid)}</Td>
                  <Td className="text-right tabular-nums">{formatBRL(m.pending)}</Td>
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

function ContractForm({ open, entityId, onClose, onSaved }: { open: boolean; entityId: string; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ number: '', object: '', monthlyValue: '', startDate: '', endDate: '', status: 'ACTIVE', notes: '' });
  const m = useMutation({ mutationFn: () => api('/financeiro/contracts', { method: 'POST', body: { entityId, number: f.number, object: f.object || null, monthlyValue: f.monthlyValue || null, startDate: f.startDate || null, endDate: f.endDate || null, status: f.status, notes: f.notes || null } }), onSuccess: onSaved });
  const b = (k: keyof typeof f) => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }) });
  return (
    <Dialog open={open} onClose={onClose} title="Novo contrato">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Número"><Input {...b('number')} /></Field>
        <Field label="Situação"><Select {...b('status')}>{CONTRACT_STATUSES.map((s) => <option key={s} value={s}>{CONTRACT_STATUS_LABELS[s]}</option>)}</Select></Field>
        <Field label="Valor mensal (ex.: 1320.00)"><Input {...b('monthlyValue')} /></Field>
        <div />
        <Field label="Início"><Input type="date" {...b('startDate')} /></Field>
        <Field label="Fim"><Input type="date" {...b('endDate')} /></Field>
        <Field label="Objeto" className="md:col-span-2"><Textarea rows={2} {...b('object')} /></Field>
        <Field label="Observações" className="md:col-span-2"><Textarea rows={2} {...b('notes')} /></Field>
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => m.mutate()} disabled={m.isPending || !f.number}>Salvar</Button></div>
    </Dialog>
  );
}

function AmendmentForm({ contract, onClose, onSaved }: { contract: ContractRow | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ label: '', kind: 'TERM', newEndDate: '', newMonthlyValue: '', signedAt: '', description: '' });
  const m = useMutation({ mutationFn: () => api(`/financeiro/contracts/${contract!.id}/amendments`, { method: 'POST', body: { label: f.label || null, kind: f.kind, newEndDate: f.newEndDate || null, newMonthlyValue: f.newMonthlyValue || null, signedAt: f.signedAt || null, description: f.description || null } }), onSuccess: onSaved });
  const b = (k: keyof typeof f) => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }) });
  return (
    <Dialog open={Boolean(contract)} onClose={onClose} title={`Novo aditivo — contrato ${contract?.number ?? ''}`}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Identificação (ex.: 2º ADT)"><Input {...b('label')} /></Field>
        <Field label="Tipo"><Select {...b('kind')}><option value="TERM">Prazo</option><option value="VALUE">Valor</option><option value="OBJECT">Objeto</option><option value="MIXED">Misto</option><option value="OTHER">Outro</option></Select></Field>
        <Field label="Nova vigência (fim)"><Input type="date" {...b('newEndDate')} /></Field>
        <Field label="Novo valor mensal"><Input {...b('newMonthlyValue')} /></Field>
        <Field label="Assinado em"><Input type="date" {...b('signedAt')} /></Field>
        <Field label="Descrição" className="md:col-span-2"><Textarea rows={2} {...b('description')} /></Field>
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => m.mutate()} disabled={m.isPending}>Salvar aditivo</Button></div>
    </Dialog>
  );
}
