'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { GOAL_METRIC_LABELS, formatBRL, todayIso, type CrmDashboard, type GoalMetric, type OpportunityRow } from '@siow/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAssignees } from '@/components/panels/tasks-panel';
import { Button, Empty, Select, Skeleton, Stat, useToast } from '@/components/ui';
import { Kanban } from '@/components/crm/kanban';
import { OpportunitiesTable } from '@/components/crm/opportunities-table';
import { CrmCalendar } from '@/components/crm/crm-calendar';
import { OpportunityForm } from '@/components/crm/opportunity-form';
import { LoseDialog, WinDialog } from '@/components/crm/opportunity-dialogs';

const VIEWS = [{ key: 'painel', label: 'Painel' }, { key: 'funil', label: 'Funil (Kanban)' }, { key: 'lista', label: 'Lista' }, { key: 'calendario', label: 'Calendário' }];

export default function ComercialPage() {
  return <Suspense fallback={<div className="muted">Carregando…</div>}><Comercial /></Suspense>;
}

function Comercial() {
  const router = useRouter();
  const search = useSearchParams();
  const qc = useQueryClient();
  const { can, user } = useAuth();
  const { data: assignees } = useAssignees();
  const [toast, showToast] = useToast();
  const initial = search.get('view');
  const [view, setViewState] = useState(VIEWS.some((v) => v.key === initial) ? initial! : 'painel');
  const [owner, setOwner] = useState('');
  const [creating, setCreating] = useState(false);
  const [win, setWin] = useState<OpportunityRow | null>(null);
  const [lose, setLose] = useState<OpportunityRow | null>(null);
  const setView = (k: string): void => { setViewState(k); router.replace(`/comercial?view=${k}`, { scroll: false }); };
  const refresh = (): void => { void qc.invalidateQueries({ queryKey: ['crm-board'] }); void qc.invalidateQueries({ queryKey: ['crm-dashboard'] }); void qc.invalidateQueries({ queryKey: ['opportunities'] }); };
  return (
    <div>
      <div className="row between">
        <div><h1>Comercial</h1><p className="sub">Funil de vendas, oportunidades, propostas e metas · {user?.organization?.name}</p></div>
        <div className="row">
          <Select value={owner} onChange={(e) => setOwner(e.target.value)} className="w-48"><option value="">Toda a equipe</option><option value={user?.id}>Minhas oportunidades</option>{assignees?.filter((a) => a.id !== user?.id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
          {can('crm.manage') && <Link href="/comercial/funil" className="btn">Configurar funil</Link>}
          {can('crm.read') && <Link href="/comercial/catalogo" className="btn">Catálogo</Link>}
          {can('crm.read') && <Link href="/comercial/metas" className="btn">Metas</Link>}
          {can('crm.write') && <Button onClick={() => setCreating(true)}>+ Nova oportunidade</Button>}
        </div>
      </div>
      <div className="seg" style={{ margin: '12px 0' }}>{VIEWS.map((v) => <button key={v.key} className={view === v.key ? 'on' : ''} onClick={() => setView(v.key)}>{v.label}</button>)}</div>
      {view === 'painel' && <Painel ownerUserId={owner || undefined} />}
      {view === 'funil' && <Kanban ownerUserId={owner || undefined} onWin={setWin} onLose={setLose} />}
      {view === 'lista' && <OpportunitiesTable />}
      {view === 'calendario' && <CrmCalendar ownerUserId={owner || undefined} />}
      <OpportunityForm open={creating} onClose={() => setCreating(false)} onSaved={(o) => { setCreating(false); refresh(); router.push(`/comercial/oportunidades/${o.id}`); }} />
      {win && <WinDialog open opportunity={win} onClose={() => setWin(null)} onDone={() => { setWin(null); refresh(); showToast('Oportunidade ganha! Abra-a para formalizar o contrato.'); }} />}
      {lose && <LoseDialog open opportunity={lose} onClose={() => setLose(null)} onDone={() => { setLose(null); refresh(); }} />}
      {toast}
    </div>
  );
}

function Painel({ ownerUserId }: { ownerUserId?: string }) {
  const router = useRouter();
  const today = todayIso();
  const [period, setPeriod] = useState({ from: `${today.slice(0, 7)}-01`, to: today });
  const { data, isLoading } = useQuery({ queryKey: ['crm-dashboard', period, ownerUserId], queryFn: () => api<CrmDashboard>('/comercial/dashboard', { query: { ...period, ownerUserId } }) });
  if (isLoading || !data) return <div className="g4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[86px]" />)}</div>;
  const c = data.cards;
  const maxFunnel = Math.max(1, ...data.funnel.map((f) => f.count));
  return (
    <div>
      <div className="row small muted" style={{ marginBottom: 8 }}>Ganhas/perdidas no período: <input type="date" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} /> a <input type="date" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} /><span>· Valores do funil são projeções calculadas a partir das oportunidades (não são receita confirmada).</span></div>
      <div className="g4">
        <Stat label="Em andamento" value={c.open} hint={`${formatBRL(c.openAmount)} no funil`} tone="info" onClick={() => router.push('/comercial?view=lista')} />
        <Stat label="Previsão ponderada" value={formatBRL(c.weightedAmount)} hint="valor × probabilidade da etapa" tone="info" />
        <Stat label="Ganhas no período" value={c.wonCount} hint={formatBRL(c.wonAmount)} tone="good" />
        <Stat label="Taxa de conversão" value={c.conversionRate === null ? '—' : `${c.conversionRate}%`} hint={`${c.lostCount} perdida(s)${c.avgCycleDays !== null ? ` · ciclo médio ${c.avgCycleDays} dias` : ''}`} tone={c.conversionRate !== null && c.conversionRate < 30 ? 'warn' : 'good'} />
      </div>
      <div className="alerts">
        {c.stalled > 0 && <Link className="warn" href="/comercial?view=lista">⏸ <b>{c.stalled}</b> oportunidade(s) parada(s) sem movimentação</Link>}
        {c.activitiesOverdue > 0 && <Link className="crit" href="/comercial?view=calendario"><b>{c.activitiesOverdue}</b> atividade(s) comercial(is) atrasada(s)</Link>}
        {c.activitiesDue > 0 && <Link className="warn" href="/comercial?view=calendario"><b>{c.activitiesDue}</b> atividade(s) para hoje</Link>}
        {!c.stalled && !c.activitiesOverdue && !c.activitiesDue && <span className="pill good">Nenhum alerta comercial</span>}
      </div>
      <div className="g2" style={{ marginTop: 12 }}>
        <div className="card"><div className="hd"><h2>Funil por etapa</h2><span className="small muted">em andamento · ganhas e perdidas no período</span></div><div className="bd funnel">
          {data.funnel.map((f) => <div key={f.stageId} className="fr"><span>{f.name}{f.stalled ? <span className="small" style={{ color: 'var(--warn)' }}> · {f.stalled} parada(s)</span> : null}</span><div className="bar" style={{ width: `${Math.max(2, (f.count / maxFunnel) * 100)}%`, opacity: f.kind === 'LOST' ? 0.4 : undefined }} /><span className="num r small">{f.count} · {formatBRL(f.amount)}</span></div>)}
        </div></div>
        <div className="card"><div className="hd"><h2>Previsão por mês de fechamento</h2></div><div className="bd">
          {data.forecast.length === 0 ? <Empty>Sem oportunidades em andamento</Empty> : <table style={{ width: '100%' }}><thead><tr><th className="l">Mês</th><th className="r">Oportunidades</th><th className="r">Esperado</th><th className="r">Ponderado</th></tr></thead><tbody>{data.forecast.map((m) => <tr key={m.month}><td>{m.month === 'sem data' ? 'Sem previsão' : `${m.month.slice(5)}/${m.month.slice(0, 4)}`}</td><td className="r num">{m.count}</td><td className="r num">{formatBRL(m.expected)}</td><td className="r num">{formatBRL(m.weighted)}</td></tr>)}</tbody></table>}
        </div></div>
        <div className="card"><div className="hd"><h2>Desempenho por responsável</h2></div><div className="bd">
          {data.byOwner.length === 0 ? <Empty>Sem dados</Empty> : <table style={{ width: '100%' }}><thead><tr><th className="l">Responsável</th><th className="r">Abertas</th><th className="r">Ganhas</th><th className="r">Valor ganho</th><th className="r">Perdidas</th></tr></thead><tbody>{data.byOwner.map((o) => <tr key={o.userId ?? 'none'}><td>{o.name}</td><td className="r num">{o.open}</td><td className="r num">{o.won}</td><td className="r num">{formatBRL(o.wonAmount)}</td><td className="r num">{o.lost}</td></tr>)}</tbody></table>}
        </div></div>
        <div className="card"><div className="hd"><h2>Metas vigentes</h2><Link href="/comercial/metas" className="small">gerenciar</Link></div><div className="bd">
          {data.goals.length === 0 ? <Empty>Nenhuma meta para hoje</Empty> : data.goals.map((g) => <div key={g.id} style={{ marginBottom: 10 }}><div className="row between small"><span>{g.label ?? GOAL_METRIC_LABELS[g.metric as GoalMetric]} · {g.userName ?? 'Equipe'}</span><b>{g.percent}%</b></div><div className="goal"><i style={{ width: `${Math.min(100, g.percent)}%` }} /></div><div className="small muted">{g.metric === 'WON_AMOUNT' ? `${formatBRL(g.achieved)} de ${formatBRL(g.target)}` : `${Number(g.achieved)} de ${Number(g.target)}`}</div></div>)}
        </div></div>
        <div className="card"><div className="hd"><h2>Motivos de perda</h2></div><div className="bd">{data.lossReasons.length === 0 ? <Empty>Nenhuma perda no período</Empty> : <ul className="hist">{data.lossReasons.map((r) => <li key={r.reason} className="row between"><span>{r.reason}</span><b>{r.count}</b></li>)}</ul>}</div></div>
        <div className="card"><div className="hd"><h2>Oportunidades paradas</h2></div><div className="bd">{data.stalledList.length === 0 ? <Empty>Nenhuma</Empty> : <ul className="hist">{data.stalledList.map((s) => <li key={s.id} className="row between"><Link href={`/comercial/oportunidades/${s.id}`}>{s.title} <span className="muted small">· {s.entityName} · {s.stageName}</span></Link><b style={{ color: 'var(--warn)' }}>{s.daysInStage} d</b></li>)}</ul>}</div></div>
      </div>
    </div>
  );
}
