'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ENTITY_TYPE_LABELS, formatBRL, formatBrDate, formatBrDateTime, todayIso, type EntityType, type ExecutiveDashboard, type PartnerRow } from '@siow/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFilterOptions } from '@/components/global-filters';
import { Badge, Empty, Input, Select, Skeleton, Stat } from '@/components/ui';

/** Séries do gráfico de receita: paleta validada (CVD/contraste) nos dois temas. */
const SERIES = [{ key: 'forecast', label: 'Prevista (projeção)', color: '#0891b2', dashed: true }, { key: 'invoiced', label: 'Faturada', color: '#7c3aed' }, { key: 'received', label: 'Recebida', color: '#059669' }] as const;
const brl0 = (v: string | number): string => formatBRL(v).replace(/,\d{2}$/, '');

export default function ExecutivePage() {
  const router = useRouter();
  const { can } = useAuth();
  const { data: o } = useFilterOptions();
  const { data: partners } = useQuery({ queryKey: ['partners'], queryFn: () => api<PartnerRow[]>('/parceiros'), enabled: can('partners.read') });
  const year = todayIso().slice(0, 4);
  const [f, setF] = useState({ from: `${year}-01-01`, to: todayIso(), uf: '', municipality: '', entityId: '', responsibleUserId: '', partnerId: '' });
  const query = Object.fromEntries(Object.entries(f).filter(([, v]) => v));
  const { data: d, isFetching, error } = useQuery({ queryKey: ['bi-executive', query], queryFn: () => api<ExecutiveDashboard>('/bi/executive', { query }) });
  const b = (k: keyof typeof f) => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value }) });
  return (
    <div>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div><h1>Dashboard executivo</h1><p className="sub">{d ? `Visão consolidada · ${d.scope} · ${formatBrDate(d.period.from)} a ${formatBrDate(d.period.to)} · atualizado ${formatBrDateTime(d.generatedAt)}` : 'Carregando…'}</p></div>
        <div className="seg"><button className="on">Executivo</button><button onClick={() => router.push('/comercial')}>Comercial</button><button onClick={() => router.push('/financeiro')}>Financeiro</button></div>
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', margin: '12px 0' }}>
        <Input type="date" {...b('from')} aria-label="De" /><Input type="date" {...b('to')} aria-label="Até" />
        <Select {...b('uf')}><option value="">Toda UF</option>{o?.ufs.map((u) => <option key={u} value={u}>{u}</option>)}</Select>
        <Select {...b('municipality')}><option value="">Todo município</option>{o?.municipalities.map((m) => <option key={m} value={m}>{m}</option>)}</Select>
        <Select {...b('entityId')}><option value="">Toda entidade</option>{o?.entities.map((e) => <option key={e.id} value={e.id}>{e.shortName ?? e.name}</option>)}</Select>
        <Select {...b('responsibleUserId')}><option value="">Todo responsável</option>{o?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
        {partners && <Select {...b('partnerId')}><option value="">Todo parceiro</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>}
      </div>
      <p className="small muted" style={{ margin: '0 0 10px' }}><Badge tone="good">confirmado</Badge> fatos registrados (notas, recebimentos, contratos) · <Badge tone="info">projeção</Badge> receita prevista por contrato e funil ponderado · <Badge tone="neutral">calculado</Badge> taxas e médias{isFetching ? ' · atualizando…' : ''}</p>
      {error && <div className="alert crit">Falha ao carregar o painel.</div>}
      {!d ? <div className="g4"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div> : (
        <>
          <h3 className="sec">Carteira e receita</h3>
          <div className="g4">
            <Stat label="Clientes ativos" value={d.portfolio.clients} tone="info" hint={`${d.portfolio.exClients} ex-clientes · ${d.portfolio.leads} leads · +${d.portfolio.newClientsInPeriod} novos / −${d.portfolio.lostClientsInPeriod} perdidos no período`} onClick={() => router.push('/financeiro/relatorios?r=portfolio')} />
            <Stat label="Receita prevista/mês" value={formatBRL(d.revenue.forecastMonthly)} tone="info" hint={`projeção · ${d.contracts.active} contratos ativos · ${formatBRL(d.revenue.forecastPeriod)} no período`} onClick={() => router.push('/financeiro/relatorios?r=revenue_vs_actual')} />
            <Stat label="Faturado no período" value={formatBRL(d.revenue.invoiced)} tone="good" hint={`confirmado · recebido ${formatBRL(d.revenue.received)}`} />
            <Stat label="Em aberto" value={formatBRL(d.revenue.pending)} tone={Number(d.revenue.overdue) > 0 ? 'critical' : 'warn'} hint={`${formatBRL(d.revenue.overdue)} com +30 dias · ${d.revenue.defaultersCount} entidades · inadimplência ${d.revenue.defaultRate ?? '—'}%`} onClick={() => router.push('/financeiro/relatorios?r=defaulters')} />
          </div>
          <RevenueChart series={d.revenue.series} />
          <h3 className="sec">Contratos, renovações e saúde da carteira</h3>
          <div className="g4">
            <Stat label="Contratos a vencer (90 dias)" value={d.contracts.expiring90} tone={d.contracts.expiring90 ? 'warn' : 'good'} hint={`${formatBRL(d.contracts.expiring90Monthly)}/mês em risco · ${d.contracts.draft} rascunho(s)`} onClick={() => router.push('/financeiro/relatorios?r=contracts_expiring')} />
            <Stat label="Renovações em aberto" value={d.contracts.renewalsOpen} hint={`${d.contracts.renewedInPeriod} renovados · ${d.contracts.notRenewedInPeriod} não renovados no período`} onClick={() => router.push('/financeiro/contratos?view=renovacoes')} />
            <Stat label="Saúde média" value={d.health.avgScore ?? '—'} tone={d.health.risk ? 'critical' : d.health.attention ? 'warn' : 'good'} hint={`${d.health.healthy} saudáveis · ${d.health.attention} atenção · ${d.health.risk} risco · ${d.health.noData} sem dados`} onClick={() => router.push('/financeiro/relatorios?r=portfolio_health')} />
            <div className="card"><div className="bd small"><b>Maior risco</b>{d.health.worst.length === 0 ? <div className="muted">—</div> : d.health.worst.slice(0, 5).map((w) => <div key={w.entityId} className="row between"><Link href={`/financeiro/entidades/${w.entityId}`}>{w.name}</Link><Badge tone={w.score < 50 ? 'critical' : 'warn'}>{w.score}</Badge></div>)}</div></div>
          </div>
          <h3 className="sec">Comercial</h3>
          <div className="g4">
            <Stat label="Funil em aberto" value={formatBRL(d.sales.openAmount)} tone="info" hint={`projeção · ${d.sales.open} oportunidades · ponderado ${formatBRL(d.sales.weightedAmount)} · ${d.sales.stalled} paradas`} onClick={() => router.push('/comercial')} />
            <Stat label="Ganhas no período" value={d.sales.won} tone="good" hint={`${formatBRL(d.sales.wonAmount)} · ${d.sales.lost} perdidas`} />
            <Stat label="Conversão" value={d.sales.conversionRate != null ? `${d.sales.conversionRate}%` : '—'} hint={`calculado · ciclo médio ${d.sales.avgCycleDays ?? '—'} dias`} onClick={() => router.push('/financeiro/relatorios?r=conversion')} />
            <div className="card"><div className="bd small"><b>Metas vigentes</b>{d.sales.goals.length === 0 ? <div className="muted">nenhuma meta</div> : d.sales.goals.slice(0, 4).map((g, i) => <div key={i} style={{ marginTop: 4 }}><div className="row between"><span>{g.userName ?? 'Equipe'} · {g.label}</span><span className="num">{g.percent}%</span></div><div className="bar"><div className="fill" style={{ width: `${Math.min(100, g.percent)}%`, background: g.percent >= 100 ? 'var(--good)' : 'var(--accent)' }} /></div></div>)}</div></div>
          </div>
          {d.sales.byOwner.length > 0 && <div className="card" style={{ marginTop: 8 }}><div className="bd"><b className="small">Desempenho por responsável</b><div className="tbl"><table className="tbl-s"><thead><tr><th>Responsável</th><th className="r">Em aberto</th><th className="r">Ganhas</th><th className="r">Valor ganho</th><th className="r">Perdidas</th></tr></thead><tbody>{d.sales.byOwner.map((r) => <tr key={r.name}><td>{r.name}</td><td className="r num">{r.open}</td><td className="r num">{r.won}</td><td className="r num">{formatBRL(r.wonAmount)}</td><td className="r num">{r.lost}</td></tr>)}</tbody></table></div></div></div>}
          <h3 className="sec">Licitações, atendimento e parceiros</h3>
          <div className="g4">
            <Stat label="Licitações em andamento" value={d.tenders.inProgress} tone="info" hint={`${formatBRL(d.tenders.inProgressValue)} estimados · ${d.tenders.nextDeadlines} prazos em 90 dias · ${d.tenders.blockedChecklists} com checklist pendente`} onClick={() => router.push('/licitacoes')} />
            <Stat label="Taxa de vitória" value={d.tenders.winRate != null ? `${d.tenders.winRate}%` : '—'} tone="good" hint={`calculado · ${d.tenders.wonInPeriod} vencidas · ${d.tenders.lostInPeriod} perdidas · ${formatBRL(d.tenders.wonValue)}`} onClick={() => router.push('/financeiro/relatorios?r=tender_win_rate')} />
            <Stat label="Chamados em aberto" value={d.support.open} tone={d.support.breached ? 'critical' : 'info'} hint={`${d.support.breached} SLA estourado · ${d.support.atRisk} em risco · ${d.support.resolvedInPeriod} resolvidos · satisfação ${d.support.satisfactionAvg ?? '—'}/5`} onClick={() => router.push('/atendimento')} />
            <Stat label="Comissões a pagar" value={formatBRL(d.partners.due)} tone="warn" hint={`${d.partners.active} parceiros · prevista ${formatBRL(d.partners.forecast)} · paga ${formatBRL(d.partners.paid)}`} onClick={() => router.push('/financeiro/relatorios?r=partner_results')} />
          </div>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', marginTop: 8 }}>
            <div className="card"><div className="bd"><b className="small">Resultados por município (top 10 por recebido)</b>{d.byRegion.length === 0 ? <Empty>Sem dados</Empty> : <div className="tbl"><table className="tbl-s"><thead><tr><th>Município/UF</th><th className="r">Clientes</th><th className="r">Prev./mês</th><th className="r">Faturado</th><th className="r">Recebido</th><th className="r">Em aberto</th></tr></thead><tbody>{d.byRegion.slice(0, 10).map((r) => <tr key={`${r.uf}${r.municipality}`}><td>{r.municipality}/{r.uf}</td><td className="r num">{r.clients}</td><td className="r num">{brl0(r.monthly)}</td><td className="r num">{brl0(r.invoiced)}</td><td className="r num">{brl0(r.received)}</td><td className="r num">{brl0(r.pending)}</td></tr>)}</tbody></table></div>}<Link href="/financeiro/relatorios?r=results_by_region" className="small">Relatório completo →</Link></div></div>
            <div className="card"><div className="bd"><b className="small">Carteira por UF e tipo</b><div className="tbl"><table className="tbl-s"><thead><tr><th>UF</th><th className="r">Clientes</th><th className="r">Ex-clientes</th><th className="r">Leads</th></tr></thead><tbody>{d.portfolio.byUf.map((u) => <tr key={u.uf}><td>{u.uf}</td><td className="r num">{u.clients}</td><td className="r num">{u.exClients}</td><td className="r num">{u.leads}</td></tr>)}</tbody></table></div><div className="small muted" style={{ marginTop: 6 }}>{d.portfolio.byType.map((t) => `${ENTITY_TYPE_LABELS[t.type as EntityType] ?? t.type}: ${t.clients}/${t.total}`).join(' · ')}</div></div></div>
            <div className="card"><div className="bd"><b className="small">Parceiros (por comissão)</b>{d.partners.top.length === 0 ? <div className="small muted">nenhum parceiro com comissões</div> : <div className="tbl"><table className="tbl-s"><thead><tr><th>Parceiro</th><th className="r">Entidades</th><th className="r">Recebido</th><th className="r">Comissões</th></tr></thead><tbody>{d.partners.top.map((p) => <tr key={p.name}><td>{p.name}</td><td className="r num">{p.entities}</td><td className="r num">{brl0(p.received)}</td><td className="r num">{brl0(p.commissions)}</td></tr>)}</tbody></table></div>}</div></div>
          </div>
        </>
      )}
    </div>
  );
}

/** Barras agrupadas finas (prevista × faturada × recebida) por competência, com legenda, tooltip e tabela acessível. */
function RevenueChart({ series }: { series: ExecutiveDashboard['revenue']['series'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...series.flatMap((s) => [Number(s.forecast), Number(s.invoiced), Number(s.received)]));
  const W = 900, H = 220, padL = 70, padB = 28, padT = 10; const innerW = W - padL - 10; const innerH = H - padB - padT;
  const gw = innerW / Math.max(1, series.length); const bw = Math.min(14, (gw - 8) / 3);
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  return (
    <div className="card" style={{ marginTop: 8 }}><div className="bd">
      <div className="row between"><b className="small">Receita por competência</b><div className="row small" style={{ gap: 12 }}>{SERIES.map((s) => <span key={s.key} className="row" style={{ gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, border: 'dashed' in s && s.dashed ? `2px dashed ${s.color}` : undefined, opacity: 'dashed' in s && s.dashed ? 0.7 : 1 }} /> {s.label}</span>)}<button className="link" onClick={() => setTable(!table)}>{table ? 'ver gráfico' : 'ver tabela'}</button></div></div>
      {table ? (
        <div className="tbl" style={{ marginTop: 8 }}><table className="tbl-s"><thead><tr><th>Competência</th>{SERIES.map((s) => <th key={s.key} className="r">{s.label}</th>)}<th className="r">Em aberto</th></tr></thead><tbody>{series.map((p) => <tr key={p.competence}><td>{p.competence.slice(5)}/{p.competence.slice(0, 4)}</td><td className="r num">{formatBRL(p.forecast)}</td><td className="r num">{formatBRL(p.invoiced)}</td><td className="r num">{formatBRL(p.received)}</td><td className="r num">{formatBRL(p.pending)}</td></tr>)}</tbody></table></div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', marginTop: 6 }} role="img" aria-label="Receita prevista, faturada e recebida por competência">
          {ticks.map((t) => <g key={t}><line x1={padL} x2={W - 10} y1={y(t)} y2={y(t)} stroke="var(--line)" /><text x={padL - 6} y={y(t) + 4} fontSize="10" textAnchor="end" fill="var(--ink3)">{brl0(t)}</text></g>)}
          {series.map((p, i) => {
            const x0 = padL + i * gw + (gw - bw * 3 - 4) / 2;
            const vals = [Number(p.forecast), Number(p.invoiced), Number(p.received)];
            return (
              <g key={p.competence} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={padL + i * gw} y={padT} width={gw} height={innerH} fill={hover === i ? 'var(--accent-soft)' : 'transparent'} />
                {vals.map((v, k) => { const s = SERIES[k]!; const h = Math.max(v > 0 ? 2 : 0, innerH * (v / max)); return <rect key={s.key} x={x0 + k * (bw + 2)} y={padT + innerH - h} width={bw} height={h} rx={3} fill={s.color} fillOpacity={'dashed' in s && s.dashed ? 0.45 : 1} stroke={'dashed' in s && s.dashed ? s.color : 'none'} strokeDasharray={'dashed' in s && s.dashed ? '3 2' : undefined} />; })}
                <text x={padL + i * gw + gw / 2} y={H - 10} fontSize="10" textAnchor="middle" fill="var(--ink2)">{p.competence.slice(5)}/{p.competence.slice(2, 4)}</text>
              </g>
            );
          })}
          {hover !== null && series[hover] && (() => { const p = series[hover]!; const x = Math.min(W - 230, Math.max(padL, padL + hover * gw)); return <g><rect x={x} y={padT + 4} width={220} height={66} rx={8} fill="var(--card2)" stroke="var(--line2)" /><text x={x + 10} y={padT + 20} fontSize="11" fill="var(--ink)" fontWeight="600">{p.competence.slice(5)}/{p.competence.slice(0, 4)}</text>{SERIES.map((s, k) => <text key={s.key} x={x + 10} y={padT + 36 + k * 13} fontSize="10" fill="var(--ink2)"><tspan fill={s.color}>■</tspan> {s.label}: {formatBRL(p[s.key])}</text>)}</g>; })()}
        </svg>
      )}
      <p className="small muted" style={{ margin: '6px 0 0' }}>Prevista = projeção pelos contratos ativos (última nota ou valor contratual); faturada e recebida = notas registradas no Financeiro.</p>
    </div></div>
  );
}
