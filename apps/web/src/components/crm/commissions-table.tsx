'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { COMMISSION_STATUSES, COMMISSION_STATUS_LABELS, formatBRL, formatBrDate, todayIso, type CommissionRow, type CommissionStatus, type Paginated } from '@siow/shared';
import { api, ApiError } from '@/lib/api';
import { Badge, Button, Dialog, Empty, Field, Input, Pagination, Select, Table, Td, Textarea, Th, useToast } from '@/components/ui';

const TONE: Record<string, 'info' | 'warn' | 'good' | 'neutral'> = { FORECAST: 'info', DUE: 'warn', PAID: 'good', REVERSED: 'neutral' };
const errMsg = (e: unknown): string => (e instanceof ApiError ? e.message : 'Erro inesperado');

/** Extrato de comissões (por parceiro ou geral) com filtros e registro de pagamento em lote. `readOnly` para o portal do parceiro. */
export function CommissionsTable({ partnerId, readOnly, endpoint }: { partnerId?: string; readOnly?: boolean; endpoint?: string }) {
  const qc = useQueryClient();
  const [toast, showToast] = useToast();
  const [f, setF] = useState({ status: '', year: '', month: '', page: 1 });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [paying, setPaying] = useState(false);
  const query = { partnerId, status: f.status || undefined, year: f.year || undefined, month: f.month || undefined, page: f.page, pageSize: 50 };
  const { data } = useQuery({ queryKey: ['commissions', endpoint ?? '', query], queryFn: () => api<Paginated<CommissionRow> & { totals: Record<string, string> } | { commissions: Paginated<CommissionRow> & { totals: Record<string, string> } }>(endpoint ?? '/parceiros/commissions', { query }).then((r) => ('commissions' in r ? r.commissions : r)) });
  const due = data?.items.filter((c) => c.status === 'DUE') ?? [];
  const selectedAmount = (data?.items ?? []).filter((c) => sel.has(c.id)).reduce((a, c) => a + Number(c.amount), 0);
  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })}><option value="">Todas as situações</option>{COMMISSION_STATUSES.map((s) => <option key={s} value={s}>{COMMISSION_STATUS_LABELS[s]}</option>)}</Select>
        <Input placeholder="Ano" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value, page: 1 })} style={{ width: 90 }} />
        <Select value={f.month} onChange={(e) => setF({ ...f, month: e.target.value, page: 1 })}><option value="">Mês</option>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, '0')}</option>)}</Select>
        {data && <span className="small muted">Previstas {formatBRL(data.totals.FORECAST)} · A pagar {formatBRL(data.totals.DUE)} · Pagas {formatBRL(data.totals.PAID)} · Estornadas {formatBRL(data.totals.REVERSED)}</span>}
        {!readOnly && due.length > 0 && <Button size="sm" className="ml-auto" onClick={() => setPaying(true)} disabled={sel.size === 0}>Registrar pagamento ({sel.size} · {formatBRL(selectedAmount.toFixed(2))})</Button>}
        {!readOnly && due.length > 0 && <Button size="sm" variant="ghost" onClick={() => setSel(sel.size === due.length ? new Set() : new Set(due.map((c) => c.id)))}>{sel.size === due.length ? 'Limpar' : 'Selecionar a pagar'}</Button>}
      </div>
      <div className="card">
        {!data ? <div className="bd small muted">Carregando…</div> : data.items.length === 0 ? <div className="bd"><Empty>Nenhuma comissão</Empty></div> : (
          <div className="tbl"><Table>
            <thead><tr>{!readOnly && <Th />}{!partnerId && <Th>Parceiro</Th>}<Th>Entidade</Th><Th>Nota</Th><Th>Competência</Th><Th className="hide-m">Regra</Th><Th className="r">Base</Th><Th className="r">%</Th><Th className="r">Comissão</Th><Th>Situação</Th><Th className="hide-m">Datas</Th></tr></thead>
            <tbody>{data.items.map((c) => (
              <tr key={c.id}>
                {!readOnly && <Td>{c.status === 'DUE' && <input type="checkbox" checked={sel.has(c.id)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(c.id); else n.delete(c.id); setSel(n); }} />}</Td>}
                {!partnerId && <Td><Link href={`/parceiros/${c.partnerId}`} className="link">{c.partnerName}</Link></Td>}
                <Td>{readOnly ? (c.entity.shortName ?? c.entity.name) : <Link href={`/financeiro/entidades/${c.entity.id}?tab=invoices`} className="link">{c.entity.shortName ?? c.entity.name}</Link>}{c.contractNumber && <div className="small muted">contrato {c.contractNumber}</div>}</Td>
                <Td className="num">{c.invoiceNumber}<div className="small muted">{c.invoiceStatus === 'PAID' ? 'paga' : c.invoiceStatus === 'PENDING' ? 'pendente' : c.invoiceStatus.toLowerCase()}</div></Td>
                <Td className="num">{c.competence}</Td><Td className="small hide-m">{c.ruleName}</Td>
                <Td className="r num">{formatBRL(c.baseAmount)}</Td><Td className="r num">{Number(c.percent).toLocaleString('pt-BR')}%</Td><Td className="r num"><b>{formatBRL(c.amount)}</b></Td>
                <Td><Badge tone={TONE[c.status]}>{COMMISSION_STATUS_LABELS[c.status as CommissionStatus]}</Badge>{c.notes && c.status === 'REVERSED' && <div className="small muted" title={c.notes}>{c.notes.slice(0, 40)}…</div>}</Td>
                <Td className="small hide-m">{c.dueAt && <div>recebida {formatBrDate(c.dueAt)}</div>}{c.paidAt && <div>paga {formatBrDate(c.paidAt)}{c.paymentRef ? ` · ${c.paymentRef}` : ''}</div>}</Td>
              </tr>))}</tbody>
          </Table></div>
        )}
        {data && data.total > data.pageSize && <div className="bd"><Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setF({ ...f, page: p })} /></div>}
      </div>
      {paying && <PayDialog ids={[...sel]} amount={selectedAmount} onClose={() => setPaying(false)} onDone={() => { setPaying(false); setSel(new Set()); void qc.invalidateQueries({ queryKey: ['commissions'] }); void qc.invalidateQueries({ queryKey: ['partners'] }); void qc.invalidateQueries({ queryKey: ['partner-statement'] }); showToast('Pagamento registrado'); }} />}
      {toast}
    </div>
  );
}

function PayDialog({ ids, amount, onClose, onDone }: { ids: string[]; amount: number; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ paidAt: todayIso(), paymentRef: '', notes: '' });
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({ mutationFn: () => api('/parceiros/commissions/pay', { method: 'POST', body: { ids, paidAt: f.paidAt, paymentRef: f.paymentRef || null, notes: f.notes || null } }), onSuccess: onDone, onError: (e) => setError(errMsg(e)) });
  return (
    <Dialog open onClose={onClose} title={`Registrar pagamento de ${ids.length} comissão(ões) — ${formatBRL(amount.toFixed(2))}`}>
      <p className="small muted">O sistema não faz pagamentos: aqui você registra que o parceiro foi pago (data, referência do PIX/transferência). Fica na auditoria.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Data do pagamento"><Input type="date" value={f.paidAt} onChange={(e) => setF({ ...f, paidAt: e.target.value })} /></Field>
        <Field label="Referência (PIX, TED…)"><Input value={f.paymentRef} onChange={(e) => setF({ ...f, paymentRef: e.target.value })} /></Field>
        <Field label="Observações" className="md:col-span-2"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      {error && <div className="alert crit" style={{ marginTop: 10 }}>{error}</div>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => m.mutate()} disabled={m.isPending}>Confirmar pagamento</Button></div>
    </Dialog>
  );
}
