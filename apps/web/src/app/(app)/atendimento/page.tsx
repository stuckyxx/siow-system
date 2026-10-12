'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { TICKET_TYPE_LABELS, type TicketStats, type TicketType } from '@siow/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Stat } from '@/components/ui';
import { TicketsTable } from '@/components/atendimento/tickets-table';
import { TicketForm } from '@/components/atendimento/ticket-form';

export default function AtendimentoPage() { return <Suspense fallback={<div className="muted">Carregando…</div>}><View /></Suspense>; }

function View() {
  const router = useRouter();
  const search = useSearchParams();
  const { can } = useAuth();
  const [creating, setCreating] = useState(false);
  const view = search.get('fila') ?? 'todos';
  const { data: s } = useQuery({ queryKey: ['ticket-stats'], queryFn: () => api<TicketStats>('/atendimento/tickets/stats'), refetchInterval: 60_000 });
  const preset = view === 'meus' ? { assigneeUserId: 'me' } : view === 'sla' ? { slaBreached: true } : view === 'sem' ? { assigneeUserId: 'unassigned' } : undefined;
  return (
    <div>
      <div className="row between"><div><h1>Atendimento</h1><p className="sub">Chamados, solicitações comerciais e financeiras, suporte técnico, visitas e reuniões — com responsáveis, prazos (SLA), histórico e satisfação. Tudo aparece na ficha 360º da entidade.</p></div>
        <div className="row">{can('tickets.manage') && <Link href="/atendimento/campanhas" className="btn">Campanhas</Link>}{can('tickets.write') && <Button onClick={() => setCreating(true)}>+ Abrir chamado</Button>}</div></div>
      <div className="g4" style={{ marginTop: 12 }}>
        <Stat label="Em aberto" value={s ? s.open + s.inProgress + s.waiting : '—'} hint={s ? `${s.open} novos · ${s.inProgress} em atendimento · ${s.waiting} aguardando` : undefined} tone="info" onClick={() => router.replace('/atendimento?fila=todos')} />
        <Stat label="Meus chamados" value={s?.mine ?? '—'} hint="atribuídos a mim" onClick={() => router.replace('/atendimento?fila=meus')} />
        <Stat label="SLA estourado" value={s?.breached ?? '—'} hint={s ? `${s.atRisk} em risco (≤ 2h) · ${s.unassigned} sem responsável` : undefined} tone={s?.breached ? 'critical' : s?.atRisk ? 'warn' : 'good'} onClick={() => router.replace('/atendimento?fila=sla')} />
        <Stat label="Resolvidos (30 dias)" value={s?.resolved30d ?? '—'} hint={s ? `1ª resposta ${s.avgFirstResponseHours ?? '—'}h · solução ${s.avgResolutionHours ?? '—'}h · satisfação ${s.satisfactionAvg ?? '—'}/5 (${s.satisfactionCount})` : undefined} tone="good" />
      </div>
      <div className="row" style={{ margin: '12px 0', gap: 8, flexWrap: 'wrap' }}>
        <div className="seg">{[['todos', 'Todos em aberto'], ['meus', 'Meus'], ['sem', 'Sem responsável'], ['sla', 'SLA estourado']].map(([k, l]) => <button key={k} className={view === k ? 'on' : ''} onClick={() => router.replace(`/atendimento?fila=${k}`)}>{l}</button>)}</div>
        {s && s.byType.length > 0 && <span className="small muted">Por tipo: {s.byType.map((t) => `${TICKET_TYPE_LABELS[t.type as TicketType] ?? t.type} ${t.count}`).join(' · ')}</span>}
      </div>
      <TicketsTable key={view} preset={preset} />
      {creating && <TicketForm onClose={() => setCreating(false)} onSaved={(t) => { setCreating(false); router.push(`/atendimento/chamados/${t.id}`); }} />}
    </div>
  );
}
