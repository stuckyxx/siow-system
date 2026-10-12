'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { OPPORTUNITY_SOURCE_LABELS, RECURRENCE_LABELS, formatBRL, formatBrDate, formatBrDateTime, type OpportunityEventRow, type OpportunityRow, type OpportunitySource, type Recurrence } from '@siow/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { TasksPanel } from '@/components/panels/tasks-panel';
import { Button, Stat, Tabs, useToast } from '@/components/ui';
import { OpportunityForm, errMsg, usePipelines } from '@/components/crm/opportunity-form';
import { FormalizeDialog, LoseDialog, WinDialog } from '@/components/crm/opportunity-dialogs';
import { ProposalsPanel } from '@/components/crm/proposals-panel';
import { StatusBadge } from '@/components/crm/opportunities-table';

type Detail = OpportunityRow & { items: Array<{ id: string; catalogItemId: string | null; description: string; quantity: string; unitPrice: string; recurrence: string; total: string }>; events: OpportunityEventRow[] };
const TABS = [{ key: 'summary', label: 'Resumo' }, { key: 'proposals', label: 'Propostas' }, { key: 'activities', label: 'Atividades' }, { key: 'history', label: 'Histórico' }];
const EVENT_LABEL: Record<string, string> = { CREATED: 'Criada', STAGE_CHANGED: 'Etapa', WON: 'Ganha', LOST: 'Perdida', REOPENED: 'Reaberta', AMOUNT_CHANGED: 'Valor', REASSIGNED: 'Responsável', PROPOSAL_CREATED: 'Proposta', PROPOSAL_STATUS: 'Proposta', ACTIVITY_CREATED: 'Atividade', ACTIVITY_DONE: 'Atividade concluída', FORMALIZED: 'Contrato' };

export default function OpportunityPage() { return <Suspense fallback={<div className="muted">Carregando…</div>}><View /></Suspense>; }

function View() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useAuth();
  const [toast, showToast] = useToast();
  const initial = search.get('tab');
  const [tab, setTab] = useState(TABS.some((t) => t.key === initial) ? initial! : 'summary');
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<'win' | 'lose' | 'formalize' | null>(null);
  const pipelines = usePipelines();
  const { data: o } = useQuery({ queryKey: ['opportunity', id], queryFn: () => api<Detail>(`/comercial/opportunities/${id}`) });
  const refresh = (): void => { void qc.invalidateQueries({ queryKey: ['opportunity', id] }); void qc.invalidateQueries({ queryKey: ['crm-board'] }); void qc.invalidateQueries({ queryKey: ['opportunities'] }); void qc.invalidateQueries({ queryKey: ['crm-dashboard'] }); };
  const move = useMutation({ mutationFn: (stageId: string) => api(`/comercial/opportunities/${id}/move`, { method: 'POST', body: { stageId } }), onSuccess: refresh, onError: (e) => showToast(errMsg(e)) });
  const reopen = useMutation({ mutationFn: () => api(`/comercial/opportunities/${id}/reopen`, { method: 'POST', body: {} }), onSuccess: refresh, onError: (e) => showToast(errMsg(e)) });
  const del = useMutation({ mutationFn: () => api(`/comercial/opportunities/${id}`, { method: 'DELETE' }), onSuccess: () => router.push('/comercial?view=lista'), onError: (e) => showToast(errMsg(e)) });
  if (!o) return <div className="muted">Carregando…</div>;
  const stages = pipelines?.find((p) => p.id === o.pipelineId)?.stages ?? [];
  const canEdit = can('crm.write') && o.status === 'OPEN';
  return (
    <div>
      <Link href="/comercial?view=funil" className="btn sm" style={{ marginBottom: 10 }}>← Comercial</Link>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="small muted"><Link href={`/financeiro/entidades/${o.entity.id}?tab=comercial`}>{o.entity.name}</Link> · {o.entity.municipality}/{o.entity.uf}{o.source ? ` · ${OPPORTUNITY_SOURCE_LABELS[o.source as OpportunitySource] ?? o.source}` : ''}</div>
          <h1>{o.title}</h1>
          <div className="row small muted"><StatusBadge o={o} /><span>{o.daysInStage} dia(s) na etapa</span>{o.owner && <span>· responsável {o.owner.name}</span>}{o.expectedCloseDate && <span>· previsão {formatBrDate(o.expectedCloseDate)}</span>}{o.contractId && <Link href={`/financeiro/entidades/${o.entity.id}?tab=contracts`}>· ver contrato</Link>}</div>
        </div>
        <div className="row">
          {can('crm.write') && o.status === 'OPEN' && <Button variant="secondary" onClick={() => setEditing(true)}>Editar</Button>}
          {can('crm.write') && o.status === 'OPEN' && <Button variant="danger" onClick={() => setDialog('lose')}>Marcar perdida</Button>}
          {can('crm.write') && o.status === 'OPEN' && <Button onClick={() => setDialog('win')}>Marcar ganha</Button>}
          {can('crm.write') && o.status === 'WON' && !o.contractId && <Button onClick={() => setDialog('formalize')}>Formalizar contrato</Button>}
          {can('crm.write') && o.status !== 'OPEN' && !o.contractId && <Button variant="secondary" onClick={() => reopen.mutate()}>Reabrir</Button>}
          {can('crm.write') && !o.contractId && <Button variant="ghost" onClick={() => { if (confirm('Excluir esta oportunidade?')) del.mutate(); }}>Excluir</Button>}
        </div>
      </div>
      {o.status === 'OPEN' && stages.length > 0 && (
        <div className="stepper" style={{ margin: '12px 0' }}>
          {stages.map((s) => <button key={s.id} className={s.id === o.stage.id ? 'on' : s.position < o.stage.position ? 'done' : ''} disabled={!canEdit || s.kind !== 'OPEN'} title={s.kind === 'OPEN' ? `Mover para ${s.name} (${s.probability}%)` : 'Use os botões Marcar ganha / perdida'} onClick={() => s.id !== o.stage.id && move.mutate(s.id)}>{s.name}</button>)}
        </div>
      )}
      <div className="g5" style={{ marginTop: 8 }}>
        <Stat small label="Valor mensal" value={o.monthlyAmount ? formatBRL(o.monthlyAmount) : '—'} hint={o.termMonths ? `${o.termMonths} meses` : undefined} />
        <Stat small label="Valor único" value={o.oneTimeAmount ? formatBRL(o.oneTimeAmount) : '—'} />
        <Stat small label="Valor total" value={o.totalAmount ? formatBRL(o.totalAmount) : '—'} tone="info" />
        <Stat small label="Probabilidade" value={`${o.effectiveProbability}%`} hint={o.probability === null ? 'da etapa' : 'definida manualmente'} />
        <Stat small label="Ponderado" value={formatBRL(o.weightedAmount)} hint="valor × probabilidade" />
      </div>
      <Tabs tabs={[TABS[0]!, { ...TABS[1]!, count: o.proposalCount }, { ...TABS[2]!, count: o.openTaskCount }, TABS[3]!]} value={tab} onChange={setTab} />
      {tab === 'summary' && (
        <div className="g2">
          <div className="card"><div className="hd"><h2>Itens</h2></div><div className="bd small">
            {o.items.length === 0 ? <p className="muted">Sem itens detalhados (valores informados diretamente).</p> : <table style={{ width: '100%' }}><tbody>{o.items.map((i) => <tr key={i.id}><td>{i.description}</td><td className="r num">{Number(i.quantity).toLocaleString('pt-BR')} × {formatBRL(i.unitPrice)}</td><td className="muted">{RECURRENCE_LABELS[i.recurrence as Recurrence] ?? i.recurrence}</td><td className="r num">{formatBRL(i.total)}</td></tr>)}</tbody></table>}
            {o.description && <p style={{ whiteSpace: 'pre-wrap', marginTop: 10 }}>{o.description}</p>}
            {o.status === 'LOST' && <div className="alert crit" style={{ marginTop: 10 }}>Perdida em {formatBrDate(o.lostAt?.slice(0, 10))}: <b>{o.lostReason}</b>{o.lostNotes ? ` — ${o.lostNotes}` : ''}</div>}
            {o.status === 'WON' && <div className="alert good" style={{ marginTop: 10 }}>Ganha em {formatBrDate(o.wonAt?.slice(0, 10))}. {o.contractId ? 'Contrato formalizado.' : 'Contrato ainda não formalizado — use "Formalizar contrato".'}</div>}
          </div></div>
          <div className="card"><div className="hd"><h2>Próximas atividades</h2></div><div className="bd"><TasksPanel entityId={o.entity.id} opportunityId={o.id} module="COMERCIAL" compact /></div></div>
        </div>
      )}
      {tab === 'proposals' && <ProposalsPanel opportunityId={o.id} opportunityTitle={o.title} canEdit={o.status !== 'LOST'} items={o.items.map((i) => ({ catalogItemId: i.catalogItemId, description: i.description, quantity: i.quantity.replace('.', ','), unitPrice: i.unitPrice.replace('.', ','), recurrence: i.recurrence }))} />}
      {tab === 'activities' && <TasksPanel entityId={o.entity.id} opportunityId={o.id} module="COMERCIAL" />}
      {tab === 'history' && <div className="card"><div className="bd"><ul className="hist">{o.events.map((e) => <li key={e.id}><div className="row between"><span><b>{EVENT_LABEL[e.action] ?? e.action}</b>{e.fromValue && e.toValue ? ` · ${e.fromValue} → ${e.toValue}` : e.toValue ? ` · ${e.toValue}` : ''}{e.notes ? <span className="muted"> — {e.notes}</span> : null}</span><span className="small muted">{formatBrDateTime(e.createdAt)}{e.userName ? ` · ${e.userName}` : ''}</span></div></li>)}</ul></div></div>}
      <OpportunityForm open={editing} opportunity={o} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); refresh(); }} />
      {dialog === 'win' && <WinDialog open opportunity={o} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); showToast('Oportunidade ganha. Agora você pode formalizar o contrato.'); }} />}
      {dialog === 'lose' && <LoseDialog open opportunity={o} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); }} />}
      {dialog === 'formalize' && <FormalizeDialog open opportunity={o} onClose={() => setDialog(null)} onDone={(r) => { setDialog(null); refresh(); showToast(r.status === 'ACTIVE' ? 'Contrato criado e ativo' : 'Rascunho de contrato criado — ative-o na aba Contratos da entidade quando assinado'); }} />}
      {toast}
    </div>
  );
}
