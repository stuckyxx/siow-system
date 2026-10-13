'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Select, Table, Td, Th } from '@/components/ui';
import { brl, errMsg, INV_LABEL, INV_TONE, type PlatformInvoice } from './shared';

export function InvoiceActions({ inv, onDone }: { inv: PlatformInvoice; onDone: () => void }) {
  const pay = useMutation({ mutationFn: () => { const ref = window.prompt(`Confirmar pagamento da fatura ${inv.period} (${brl(inv.amount)}). Referência (opcional):`) ; if (ref === null) return Promise.reject(new Error('cancelado')); return api(`/platform/invoices/${inv.id}/pay`, { method: 'POST', body: { paymentRef: ref || null } }); }, onSuccess: onDone, onError: (e) => { if (!(e instanceof Error && e.message === 'cancelado')) window.alert(errMsg(e)); } });
  const cancel = useMutation({ mutationFn: () => { const reason = window.prompt('Motivo do cancelamento da fatura:'); if (!reason) return Promise.reject(new Error('cancelado')); return api(`/platform/invoices/${inv.id}/cancel`, { method: 'POST', body: { reason } }); }, onSuccess: onDone, onError: (e) => { if (!(e instanceof Error && e.message === 'cancelado')) window.alert(errMsg(e)); } });
  if (inv.status === 'PAID' || inv.status === 'CANCELLED') return null;
  return <span className="whitespace-nowrap"><Button size="sm" onClick={() => pay.mutate()}>Marcar paga</Button> <Button size="sm" variant="ghost" onClick={() => cancel.mutate()}>Cancelar</Button></span>;
}

export function InvoicesPanel() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const { data } = useQuery({ queryKey: ['platform-invoices', status], queryFn: () => api<PlatformInvoice[]>('/platform/invoices', { query: { status } }) });
  const run = useMutation({ mutationFn: () => api<Record<string, unknown>>('/platform/billing/run', { method: 'POST' }), onSuccess: (r) => { window.alert(`Cobrança executada: ${JSON.stringify(r)}`); qc.invalidateQueries({ queryKey: ['platform-invoices'] }); qc.invalidateQueries({ queryKey: ['platform-orgs'] }); }, onError: (e) => window.alert(errMsg(e)) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['platform-invoices'] }); qc.invalidateQueries({ queryKey: ['platform-overview'] }); qc.invalidateQueries({ queryKey: ['platform-orgs'] }); };
  return (
    <Card>
      <CardHeader><CardTitle>Faturas de assinatura</CardTitle><div className="flex gap-2 items-center"><Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40"><option value="">Todas</option>{Object.entries(INV_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select><Button size="sm" variant="secondary" onClick={() => { if (window.confirm('Executar agora a rotina de cobrança (gera faturas do mês, marca vencidas, aplica bloqueio suave após a carência)?')) run.mutate(); }}>Executar cobrança</Button></div></CardHeader>
      <CardContent className="px-0">
        <Table>
          <thead><tr><Th>Organização</Th><Th>Período</Th><Th>Valor</Th><Th>Vencimento</Th><Th>Situação</Th><Th>Pagamento</Th><Th></Th></tr></thead>
          <tbody>{data?.map((i) => <tr key={i.id}><Td>{i.organization?.name}<div className="text-xs text-ink-3">{i.organization?.slug}</div></Td><Td style={{ fontFamily: 'var(--mono)' }}>{i.period}</Td><Td className="num">{brl(i.amount)}</Td><Td>{new Date(i.dueDate).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</Td><Td><Badge tone={INV_TONE[i.status]}>{INV_LABEL[i.status]}</Badge></Td><Td className="text-ink-2 small">{i.paidAt ? `${new Date(i.paidAt).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}${i.paymentRef ? ` · ${i.paymentRef}` : ''}` : i.notes ?? '—'}</Td><Td><InvoiceActions inv={i} onDone={refresh} /></Td></tr>)}
          {data && !data.length && <tr><Td colSpan={7} className="text-center text-ink-3">Nenhuma fatura</Td></tr>}</tbody>
        </Table>
      </CardContent>
    </Card>
  );
}
