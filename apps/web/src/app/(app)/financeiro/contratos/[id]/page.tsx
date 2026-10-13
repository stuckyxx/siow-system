'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ADJUSTMENT_INDEXES, RENEWAL_STATUS_LABELS, formatBRL, formatBrDate, todayIso, type ContractFinancialStatus, type ContractLedger, type RenewalStatus } from '@siow/shared';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { AskAssistantButton } from '@/components/assistant/assistant-chat';
import { ContractStatusBadge } from '@/components/status';
import { AmendmentForm, AmendmentsTable, AttachPdf, ContractDocuments, ContractForm, LedgerView, type ContractRow } from '@/components/panels/contracts-panel';
import { Button, Dialog, Field, Input, Select, Stat, Tabs, Textarea, useToast } from '@/components/ui';

const errMsg = (e: unknown): string => (e instanceof ApiError ? `${e.message}${e.issues?.length ? ': ' + e.issues.map((i) => `${i.path} ${i.message}`).join('; ') : ''}` : 'Erro inesperado');
type Detail = ContractRow & { entity: { id: string; name: string; shortName: string | null; municipality: string; uf: string }; description: string | null; totalValue: string | null; expectsMonthlyBilling: boolean; activatedAt: string | null };
const TABS = [{ key: 'financeiro', label: 'Situação financeira' }, { key: 'ledger', label: 'Conta corrente' }, { key: 'aditivos', label: 'Aditivos e reajustes' }, { key: 'documentos', label: 'Documentos' }];

export default function ContractPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { can } = useAuth();
  const [toast, showToast] = useToast();
  const [tab, setTab] = useState('financeiro');
  const [dialog, setDialog] = useState<'activate' | 'terminate' | 'adjust' | 'amend' | 'edit' | null>(null);
  const { data: c } = useQuery({ queryKey: ['contract', id], queryFn: () => api<Detail>(`/financeiro/contracts/${id}`) });
  const { data: fs } = useQuery({ queryKey: ['contract-fs', id], queryFn: () => api<ContractFinancialStatus>(`/financeiro/contracts/${id}/financial-status`) });
  const { data: ledger } = useQuery({ queryKey: ['ledger', id], queryFn: () => api<ContractLedger>(`/financeiro/contracts/${id}/ledger`), enabled: tab === 'ledger' });
  const refresh = (): void => { for (const k of ['contract', 'contract-fs', 'ledger', 'contracts', 'contracts-list', 'contract-docs', 'renewals', 'dashboard', 'entity']) void qc.invalidateQueries({ queryKey: [k] }); };
  if (!c) return <div className="muted">Carregando…</div>;
  const write = can('contracts.write');
  const today = todayIso();
  return (
    <div>
      <Link href="/financeiro/contratos" className="btn sm" style={{ marginBottom: 10 }}>← Contratos</Link>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="small muted"><Link href={`/financeiro/entidades/${c.entity.id}?tab=contracts`}>{c.entity.name}</Link> · {c.entity.municipality}/{c.entity.uf}{c.origin === 'SYNC' ? ' · identificado no portal' : ''}</div>
          <h1>Contrato {c.number}</h1>
          <div className="row small muted"><ContractStatusBadge status={c.status} />
            <span>Vigência {formatBrDate(c.startDate)} a {formatBrDate(c.endDate)}{fs?.daysToEnd !== null && fs?.daysToEnd !== undefined && c.status === 'ACTIVE' ? ` (${fs.daysToEnd < 0 ? `${-fs.daysToEnd} dia(s) vencido` : `faltam ${fs.daysToEnd} dia(s)`})` : ''}</span>
            {c.responsibleUser && <span>· responsável {c.responsibleUser.name}</span>}
            {c.opportunityId && <Link href={`/comercial/oportunidades/${c.opportunityId}`}>· oportunidade de origem</Link>}
            {c.status === 'TERMINATED' && c.terminatedAt && <span style={{ color: 'var(--crit)' }}>· encerrado em {formatBrDate(c.terminatedAt)}{c.terminationReason ? ` (${c.terminationReason})` : ''}</span>}
          </div>
          {c.object && <p className="small" style={{ margin: '6px 0 0', color: 'var(--ink2)', maxWidth: 820 }}>{c.object}</p>}
        </div>
        <div className="row">
          <AskAssistantButton size="md" context={{ kind: 'contract', id: c.id, label: `Contrato ${c.number} · ${c.entity.name}`, path: `/financeiro/contratos/${c.id}` }} suggestions={['Resuma a situação financeira deste contrato: notas emitidas, pagas e pendentes', 'Quantos meses faltam para o fim da vigência e qual o valor total restante?', 'Crie uma tarefa para 30 dias antes do fim da vigência: iniciar renovação', 'Registre um aditivo de prazo com a justificativa que eu informar']} onChanged={() => { void qc.invalidateQueries({ queryKey: ['contract', id] }); void qc.invalidateQueries({ queryKey: ['contract-fs', id] }); }} />
          {write && c.status === 'DRAFT' && <Button onClick={() => setDialog('activate')}>Ativar contrato</Button>}
          {write && <Button variant="secondary" onClick={() => setDialog('edit')}>Editar</Button>}
          {write && c.status === 'ACTIVE' && <Button variant="secondary" onClick={() => setDialog('adjust')}>Reajuste</Button>}
          {write && c.status !== 'DRAFT' && <Button variant="secondary" onClick={() => setDialog('amend')}>+ Aditivo</Button>}
          {write && can('documents.write') && <AttachPdf contractId={c.id} onDone={(n) => { showToast(`${n} enviado`); refresh(); }} onError={showToast} />}
          {write && c.status !== 'TERMINATED' && <Button variant="danger" onClick={() => setDialog('terminate')}>Encerrar</Button>}
        </div>
      </div>
      {fs && (
        <div className="g5" style={{ marginTop: 12 }}>
          <Stat small label={fs.forecast.basis === 'ULTIMA_NOTA' ? 'Previsto (última nota)' : 'Previsto (contrato)'} value={fs.forecast.basis === 'SEM_BASE' ? '—' : `${formatBRL(fs.forecast.monthly)}/mês`} hint={fs.forecast.basis === 'SEM_BASE' ? 'sem valor contratual nem notas' : fs.forecast.remainingMonths ? `${fs.forecast.remainingMonths} mês(es) restantes · ${formatBRL(fs.forecast.remainingAmount)}` : 'sem meses restantes'} tone="info" />
          <Stat small label="Faturado (Financeiro)" value={formatBRL(fs.invoiced.total)} hint={`${fs.invoiced.count} nota(s)${fs.invoiced.lastAt ? ` · última ${formatBrDate(fs.invoiced.lastAt)}` : ''}`} />
          <Stat small label="Recebido (Financeiro)" value={formatBRL(fs.received.total)} hint={`${fs.received.count} paga(s)${fs.received.lastAt ? ` · último ${formatBrDate(fs.received.lastAt)}` : ''}`} tone="good" />
          <Stat small label="Pendente" value={formatBRL(fs.pending.total)} hint={fs.pending.count ? `${fs.pending.count} nota(s)${fs.pending.oldestDays !== null ? ` · mais antiga ${fs.pending.oldestDays} dias` : ''}` : 'nenhuma'} tone={fs.pending.count ? 'warn' : 'good'} />
          <Stat small label="Meses sem nota" value={fs.monthsNotInvoiced} hint="competências vencidas sem nota" tone={fs.monthsNotInvoiced ? 'critical' : 'good'} />
        </div>
      )}
      {fs?.renewal && <div className="alerts" style={{ marginTop: 8 }}><Link className={fs.renewal.status === 'OPEN' ? 'warn' : 'good'} href="/financeiro/contratos?view=renovacoes">↻ Renovação: {RENEWAL_STATUS_LABELS[fs.renewal.status as RenewalStatus]} · vigência até {formatBrDate(fs.renewal.endDate)}{fs.renewal.opportunityId ? ' · oportunidade no Comercial' : ''}</Link></div>}
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'financeiro' && fs && (
        <div className="g2">
          <div className="card"><div className="hd"><h2>Por exercício</h2><span className="small muted">previsto × faturado × recebido × pendente</span></div><div className="bd">
            {fs.byYear.length === 0 ? <p className="muted small">Sem competências ainda.</p> : <table style={{ width: '100%' }}><thead><tr><th className="l">Ano</th><th className="r">Previsto</th><th className="r">Faturado</th><th className="r">Recebido</th><th className="r">Pendente</th></tr></thead><tbody>{fs.byYear.map((y) => <tr key={y.year}><td>{y.year}</td><td className="r num">{formatBRL(y.expected)}</td><td className="r num">{formatBRL(y.invoiced)}</td><td className="r num" style={{ color: 'var(--good)' }}>{formatBRL(y.received)}</td><td className="r num" style={{ color: Number(y.pending) ? 'var(--warn)' : undefined }}>{formatBRL(y.pending)}</td></tr>)}</tbody></table>}
            <p className="small muted" style={{ marginTop: 8 }}>Previsto é calculado a partir do contrato (valor mensal vigente, com reajustes). Faturado, recebido e pendente vêm das notas do Financeiro. São informações distintas e nunca se misturam.</p>
          </div></div>
          <div className="card"><div className="hd"><h2>Reajustes aplicados</h2></div><div className="bd">
            {fs.adjustments.length === 0 ? <p className="muted small">Nenhum reajuste registrado.{c.status === 'ACTIVE' && write ? ' Use "Reajuste" para aplicar um índice informado.' : ''}</p> : <ul className="hist">{fs.adjustments.map((a) => <li key={a.id} className="row between"><span>{a.label ?? 'Reajuste'} · {a.indexName ?? '—'} {a.percent ? `${a.percent}%` : ''}</span><span className="num">{a.newMonthlyValue ? formatBRL(a.newMonthlyValue) : ''} <span className="small muted">desde {formatBrDate(a.effectiveFrom)}</span></span></li>)}</ul>}
            {fs.forecast.contractTotal && <p className="small muted" style={{ marginTop: 8 }}>Valor global informado: {formatBRL(fs.forecast.contractTotal)}</p>}
          </div></div>
        </div>
      )}
      {tab === 'ledger' && (ledger ? <div className="card"><div className="bd"><LedgerView data={ledger} /></div></div> : <div className="muted small">Carregando…</div>)}
      {tab === 'aditivos' && <div className="card"><div className="bd"><AmendmentsTable contract={c} canWrite={write} onChanged={refresh} onError={showToast} /></div></div>}
      {tab === 'documentos' && <div className="card"><div className="bd"><ContractDocuments contractId={c.id} canDelete={can('documents.write')} onError={showToast} />{!can('documents.read') && <p className="muted small">Sem permissão.</p>}</div></div>}

      {dialog === 'activate' && <ActivateDialog c={c} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); showToast('Contrato ativado'); }} />}
      {dialog === 'terminate' && <TerminateDialog c={c} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); showToast('Contrato encerrado'); }} />}
      {dialog === 'adjust' && <AdjustDialog c={c} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); showToast('Reajuste registrado'); }} />}
      <AmendmentForm contract={dialog === 'amend' ? c : null} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); refresh(); showToast('Aditivo registrado'); }} />
      <ContractForm contract={dialog === 'edit' ? c : null} entityId={c.entity.id} onClose={() => setDialog(null)} onSaved={(msg) => { setDialog(null); refresh(); showToast(msg); }} />
      {toast}
      <span hidden>{today}</span>
    </div>
  );
}

function ActivateDialog({ c, onClose, onDone }: { c: ContractRow; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ startDate: c.startDate ?? todayIso(), endDate: c.endDate ?? '', monthlyValue: c.monthlyValue?.replace('.', ',') ?? '', issuanceDay: '', notes: '' });
  const [error, setError] = useState<string | null>(null);
  const b = (k: keyof typeof f) => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }) });
  const m = useMutation({ mutationFn: () => api(`/financeiro/contracts/${c.id}/activate`, { method: 'POST', body: { startDate: f.startDate || null, endDate: f.endDate || null, monthlyValue: f.monthlyValue ? f.monthlyValue.replace(/\./g, '').replace(',', '.') : null, issuanceDay: f.issuanceDay ? Number(f.issuanceDay) : null, notes: f.notes || null } }), onSuccess: onDone, onError: (e) => setError(errMsg(e)) });
  return (
    <Dialog open onClose={onClose} title={`Ativar contrato ${c.number}`}>
      <p className="small muted">Confirme a contratação: o contrato passa a ATIVO, entra na receita prevista e nos contratos ativos da entidade.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Início da vigência"><Input type="date" {...b('startDate')} /></Field>
        <Field label="Fim da vigência"><Input type="date" {...b('endDate')} /></Field>
        <Field label="Valor mensal (R$)"><Input {...b('monthlyValue')} /></Field>
        <Field label="Dia de emissão da nota (cria alarme; opcional)"><Input type="number" min={1} max={31} {...b('issuanceDay')} /></Field>
        <Field label="Observações" className="md:col-span-2"><Textarea rows={2} {...b('notes')} /></Field>
      </div>
      {error && <div className="alert crit" style={{ marginTop: 10 }}>{error}</div>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => m.mutate()} disabled={m.isPending}>Ativar</Button></div>
    </Dialog>
  );
}

function TerminateDialog({ c, onClose, onDone }: { c: ContractRow; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ date: todayIso(), reason: 'Término da vigência', notes: '' });
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({ mutationFn: () => api(`/financeiro/contracts/${c.id}/terminate`, { method: 'POST', body: { date: f.date, reason: f.reason, notes: f.notes || null } }), onSuccess: onDone, onError: (e) => setError(errMsg(e)) });
  return (
    <Dialog open onClose={onClose} title={`Encerrar contrato ${c.number}`}>
      <p className="small muted">O contrato passa a ENCERRADO, sai dos ativos e as renovações em aberto são canceladas. As notas e o histórico permanecem.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Data do encerramento"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Motivo"><Select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>{['Término da vigência', 'Rescisão pelo cliente', 'Rescisão pela empresa', 'Não renovado', 'Substituído por novo contrato', 'Troca de gestão', 'Outro'].map((r) => <option key={r} value={r}>{r}</option>)}</Select></Field>
        <Field label="Observações" className="md:col-span-2"><Textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      {error && <div className="alert crit" style={{ marginTop: 10 }}>{error}</div>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="danger" onClick={() => m.mutate()} disabled={m.isPending}>Encerrar</Button></div>
    </Dialog>
  );
}

function AdjustDialog({ c, onClose, onDone }: { c: ContractRow; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ indexName: 'IPCA', percent: '', effectiveFrom: `${todayIso().slice(0, 7)}-01`, signedAt: '', newMonthlyValue: '', description: '' });
  const [error, setError] = useState<string | null>(null);
  const current = Number(c.monthlyValue ?? 0);
  const computed = f.percent && current ? (current * (1 + Number(f.percent.replace(',', '.')) / 100)).toFixed(2) : null;
  const b = (k: keyof typeof f) => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }) });
  const m = useMutation({ mutationFn: () => api(`/financeiro/contracts/${c.id}/adjust`, { method: 'POST', body: { indexName: f.indexName, percent: Number(f.percent.replace(',', '.')), effectiveFrom: f.effectiveFrom, signedAt: f.signedAt || null, newMonthlyValue: f.newMonthlyValue ? f.newMonthlyValue.replace(/\./g, '').replace(',', '.') : null, description: f.description || null } }), onSuccess: onDone, onError: (e) => setError(errMsg(e)) });
  return (
    <Dialog open onClose={onClose} title={`Reajuste — contrato ${c.number}`}>
      <p className="small muted">Informe o índice e o percentual apurado (o sistema não consulta índices automaticamente). O reajuste vira um aditivo e passa a valer na conta corrente a partir da competência indicada.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Índice"><Select {...b('indexName')}>{ADJUSTMENT_INDEXES.map((i) => <option key={i} value={i}>{i}</option>)}</Select></Field>
        <Field label="Percentual (%)"><Input {...b('percent')} placeholder="4,62" inputMode="decimal" /></Field>
        <Field label="Vigora a partir de"><Input type="date" {...b('effectiveFrom')} /></Field>
        <Field label="Assinado em (opcional)"><Input type="date" {...b('signedAt')} /></Field>
        <Field label={`Novo valor mensal (calculado: ${computed ? formatBRL(computed) : '—'}; informe para sobrescrever)`} className="md:col-span-2"><Input {...b('newMonthlyValue')} placeholder={computed ? computed.replace('.', ',') : ''} /></Field>
        <Field label="Justificativa / observações" className="md:col-span-2"><Textarea rows={2} {...b('description')} /></Field>
      </div>
      <p className="small muted">Valor atual: {c.monthlyValue ? formatBRL(c.monthlyValue) : '—'}</p>
      {error && <div className="alert crit" style={{ marginTop: 10 }}>{error}</div>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => m.mutate()} disabled={m.isPending || !f.percent}>Aplicar reajuste</Button></div>
    </Dialog>
  );
}
