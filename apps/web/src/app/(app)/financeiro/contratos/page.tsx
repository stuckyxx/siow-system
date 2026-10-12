'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { CONTRACT_STATUSES, CONTRACT_STATUS_LABELS, RENEWAL_STATUS_LABELS, TASK_STATUS_LABELS, formatBRL, formatBrDate, type ContractRenewalRow, type RenewalStatus, type TaskStatus } from '@siow/shared';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ContractStatusBadge } from '@/components/status';
import type { ContractRow } from '@/components/panels/contracts-panel';
import { Badge, Button, Dialog, Empty, Field, Input, Select, Table, Td, Textarea, Th, useToast } from '@/components/ui';

const errMsg = (e: unknown): string => (e instanceof ApiError ? e.message : 'Erro inesperado');

export default function ContractsPage() { return <Suspense fallback={<div className="muted">Carregando…</div>}><View /></Suspense>; }

function View() {
  const router = useRouter();
  const search = useSearchParams();
  const [view, setViewState] = useState(search.get('view') === 'renovacoes' ? 'renovacoes' : 'contratos');
  const setView = (v: string): void => { setViewState(v); router.replace(`/financeiro/contratos?view=${v}`, { scroll: false }); };
  const { data: renewals } = useQuery({ queryKey: ['renewals', 'OPEN'], queryFn: () => api<ContractRenewalRow[]>('/financeiro/contracts/renewals', { query: { status: 'OPEN' } }) });
  return (
    <div>
      <div className="row between"><div><h1>Contratos</h1><p className="sub">Cadastro, vigência, aditivos, reajustes, renovações e situação financeira. Para cadastrar um contrato, abra a entidade → aba Contratos (ou formalize uma oportunidade ganha no Comercial).</p></div></div>
      <div className="seg" style={{ margin: '4px 0 12px' }}><button className={view === 'contratos' ? 'on' : ''} onClick={() => setView('contratos')}>Contratos</button><button className={view === 'renovacoes' ? 'on' : ''} onClick={() => setView('renovacoes')}>Renovações{renewals?.length ? ` (${renewals.length})` : ''}</button></div>
      {view === 'contratos' ? <ContractsList /> : <Renewals />}
    </div>
  );
}

function ContractsList() {
  const router = useRouter();
  const [f, setF] = useState({ q: '', status: '', expiring: '' });
  const { data } = useQuery({ queryKey: ['contracts-list', f], queryFn: () => api<ContractRow[]>('/financeiro/contracts', { query: { q: f.q || undefined, status: f.status || undefined, expiringDays: f.expiring ? Number(f.expiring) : undefined } }) });
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        <Input placeholder="Buscar número, objeto ou entidade" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} style={{ minWidth: 280 }} />
        <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, expiring: '' })}><option value="">Todas as situações</option>{CONTRACT_STATUSES.map((s) => <option key={s} value={s}>{CONTRACT_STATUS_LABELS[s]}</option>)}</Select>
        <Select value={f.expiring} onChange={(e) => setF({ ...f, expiring: e.target.value, status: '' })}><option value="">Qualquer vigência</option><option value="30">Vencendo em 30 dias</option><option value="90">Vencendo em 90 dias</option><option value="180">Vencendo em 180 dias</option></Select>
      </div>
      <div className="card">
        {!data ? <div className="bd small muted">Carregando…</div> : data.length === 0 ? <div className="bd"><Empty>Nenhum contrato</Empty></div> : (
          <div className="tbl"><Table>
            <thead><tr><Th>Contrato</Th><Th>Entidade</Th><Th>Situação</Th><Th>Vigência</Th><Th className="r">Valor mensal</Th><Th className="r hide-m">Aditivos</Th><Th className="hide-m">Responsável</Th></tr></thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="click" onClick={() => router.push(`/financeiro/contratos/${c.id}`)}>
                  <Td><span className="link">{c.number}</span>{c.origin === 'SYNC' && <Badge tone="neutral" className="ml-2">portal</Badge>}{c.object && <div className="small muted" style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.object}</div>}</Td>
                  <Td>{c.entity?.shortName ?? c.entity?.name ?? '—'}</Td>
                  <Td><ContractStatusBadge status={c.status} /></Td>
                  <Td className="num small">{formatBrDate(c.startDate)} a {formatBrDate(c.endDate)}{c.endDate && c.status === 'ACTIVE' && c.endDate < today && <div style={{ color: 'var(--crit)' }}>vencido</div>}</Td>
                  <Td className="r num">{c.monthlyValue ? formatBRL(c.monthlyValue) : '—'}</Td>
                  <Td className="r num hide-m">{c.amendments.length}</Td>
                  <Td className="hide-m">{c.responsibleUser?.name ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table></div>
        )}
      </div>
    </div>
  );
}

function Renewals() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [toast, showToast] = useToast();
  const [status, setStatus] = useState('OPEN');
  const [deciding, setDeciding] = useState<{ r: ContractRenewalRow; status: 'RENEWED' | 'NOT_RENEWED' | 'CANCELLED' } | null>(null);
  const { data } = useQuery({ queryKey: ['renewals', status], queryFn: () => api<ContractRenewalRow[]>('/financeiro/contracts/renewals', { query: { status: status || undefined } }) });
  const tone = (s: string) => (s === 'RENEWED' ? 'good' : s === 'OPEN' ? 'warn' : s === 'NOT_RENEWED' ? 'critical' : 'neutral');
  return (
    <div>
      <div className="row between" style={{ marginBottom: 10 }}>
        <span className="small muted">Abertas automaticamente quando a vigência entra na janela de renovação (padrão 90 dias), com oportunidade no Comercial e tarefa na agenda. A decisão é sempre sua: nenhum aditivo é criado automaticamente.</span>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44"><option value="">Todas</option>{(['OPEN', 'RENEWED', 'NOT_RENEWED', 'CANCELLED'] as RenewalStatus[]).map((s) => <option key={s} value={s}>{RENEWAL_STATUS_LABELS[s]}</option>)}</Select>
      </div>
      <div className="card">
        {!data ? <div className="bd small muted">Carregando…</div> : data.length === 0 ? <div className="bd"><Empty>Nenhuma renovação {status === 'OPEN' ? 'em aberto' : ''}</Empty></div> : (
          <div className="tbl"><Table>
            <thead><tr><Th>Contrato</Th><Th>Entidade</Th><Th>Fim da vigência</Th><Th className="r">Valor mensal</Th><Th>Situação</Th><Th>Oportunidade</Th><Th>Tarefa</Th><Th /></tr></thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id}>
                  <Td><Link href={`/financeiro/contratos/${r.contractId}`} className="link">{r.contractNumber}</Link></Td>
                  <Td><Link href={`/financeiro/entidades/${r.entity.id}?tab=contracts`}>{r.entity.shortName ?? r.entity.name}</Link></Td>
                  <Td className="num">{formatBrDate(r.endDate)}<div className={`small ${r.daysToEnd < 0 ? 'text-critical' : 'muted'}`}>{r.daysToEnd < 0 ? `${-r.daysToEnd} dia(s) vencido` : `em ${r.daysToEnd} dia(s)`}</div></Td>
                  <Td className="r num">{r.monthlyValue ? formatBRL(r.monthlyValue) : '—'}</Td>
                  <Td><Badge tone={tone(r.status)}>{RENEWAL_STATUS_LABELS[r.status as RenewalStatus]}</Badge>{r.decidedBy && <div className="small muted">{r.decidedBy}</div>}</Td>
                  <Td>{r.opportunityId ? <Link href={`/comercial/oportunidades/${r.opportunityId}`} className="link small">{r.opportunityStatus === 'WON' ? 'ganha' : r.opportunityStatus === 'LOST' ? 'perdida' : 'em andamento'}</Link> : '—'}</Td>
                  <Td className="small">{r.taskStatus ? TASK_STATUS_LABELS[r.taskStatus as TaskStatus] ?? r.taskStatus : '—'}</Td>
                  <Td className="r" style={{ whiteSpace: 'nowrap' }}>{r.status === 'OPEN' && can('contracts.write') && <><Button size="sm" onClick={() => setDeciding({ r, status: 'RENEWED' })}>Renovado</Button> <Button size="sm" variant="danger" onClick={() => setDeciding({ r, status: 'NOT_RENEWED' })}>Não renovado</Button></>}</Td>
                </tr>
              ))}
            </tbody>
          </Table></div>
        )}
      </div>
      {deciding && <DecideDialog r={deciding.r} status={deciding.status} onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); void qc.invalidateQueries({ queryKey: ['renewals'] }); void qc.invalidateQueries({ queryKey: ['dashboard'] }); showToast('Renovação registrada'); }} />}
      {toast}
    </div>
  );
}

function DecideDialog({ r, status, onClose, onDone }: { r: ContractRenewalRow; status: 'RENEWED' | 'NOT_RENEWED' | 'CANCELLED'; onClose: () => void; onDone: () => void }) {
  const { data: contract } = useQuery({ queryKey: ['contract', r.contractId], queryFn: () => api<ContractRow>(`/financeiro/contracts/${r.contractId}`) });
  const [f, setF] = useState({ amendmentId: '', notes: '' });
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({ mutationFn: () => api(`/financeiro/contracts/renewals/${r.id}`, { method: 'POST', body: { status, amendmentId: f.amendmentId || null, notes: f.notes || null } }), onSuccess: onDone, onError: (e) => setError(errMsg(e)) });
  return (
    <Dialog open onClose={onClose} title={`${status === 'RENEWED' ? 'Confirmar renovação' : 'Registrar não renovação'} — contrato ${r.contractNumber}`}>
      {status === 'RENEWED' ? <p className="small muted">Vincule o aditivo de prorrogação já registrado na ficha do contrato (opcional). A oportunidade de renovação é marcada como ganha e a tarefa concluída.</p> : <p className="small muted">A oportunidade de renovação é marcada como perdida (motivo "Não renovado") e a tarefa cancelada. O contrato continua até o fim da vigência; encerre-o na ficha quando for o caso.</p>}
      <div className="grid gap-3">
        {status === 'RENEWED' && <Field label="Aditivo de prorrogação (opcional)"><Select value={f.amendmentId} onChange={(e) => setF({ ...f, amendmentId: e.target.value })}><option value="">—</option>{contract?.amendments.map((a) => <option key={a.id} value={a.id}>{a.label ?? `${a.sequence}º`} · {a.newEndDate ? `até ${formatBrDate(a.newEndDate)}` : a.kind}</option>)}</Select></Field>}
        <Field label="Observações"><Textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      {error && <div className="alert crit" style={{ marginTop: 10 }}>{error}</div>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant={status === 'RENEWED' ? 'default' : 'danger'} onClick={() => m.mutate()} disabled={m.isPending}>Confirmar</Button></div>
    </Dialog>
  );
}
