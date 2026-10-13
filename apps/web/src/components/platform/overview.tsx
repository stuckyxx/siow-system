'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, Stat } from '@/components/ui';
import { brl, INV_LABEL, ORG_LABEL, SUB_LABEL } from './shared';

interface Overview { organizations: Array<{ status: string; count: number }>; subscriptions: Array<{ status: string; count: number; amount: string }>; invoices: Array<{ status: string; count: number; amount: string }>; plans: number; mrr: string }

export function OverviewPanel() {
  const { data } = useQuery({ queryKey: ['platform-overview'], queryFn: () => api<Overview>('/platform/overview') });
  if (!data) return <div className="text-sm text-ink-3">Carregando…</div>;
  const sum = (a: Array<{ count: number }>) => a.reduce((x, y) => x + y.count, 0);
  const overdue = data.invoices.find((i) => i.status === 'OVERDUE');
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="Organizações" value={sum(data.organizations)} hint={data.organizations.map((o) => `${o.count} ${ORG_LABEL[o.status] ?? o.status}`).join(' · ')} />
        <Stat label="Receita recorrente (MRR)" value={brl(data.mrr)} hint="assinaturas ativas e em atraso" tone="good" />
        <Stat label="Faturas vencidas" value={overdue?.count ?? 0} hint={overdue ? brl(overdue.amount) : 'nenhuma'} tone={overdue ? 'critical' : 'good'} />
        <Stat label="Planos ativos" value={data.plans} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card><CardHeader><CardTitle>Assinaturas por situação</CardTitle></CardHeader><CardContent>{data.subscriptions.map((s) => <div key={s.status} className="flex justify-between py-1 border-b border-line text-sm"><span>{SUB_LABEL[s.status] ?? s.status}</span><span>{s.count} · {brl(s.amount)}/mês</span></div>)}{!data.subscriptions.length && <div className="text-ink-3 text-sm">Nenhuma assinatura</div>}</CardContent></Card>
        <Card><CardHeader><CardTitle>Faturas da plataforma</CardTitle></CardHeader><CardContent>{data.invoices.map((s) => <div key={s.status} className="flex justify-between py-1 border-b border-line text-sm"><span>{INV_LABEL[s.status] ?? s.status}</span><span>{s.count} · {brl(s.amount)}</span></div>)}{!data.invoices.length && <div className="text-ink-3 text-sm">Nenhuma fatura emitida</div>}</CardContent></Card>
      </div>
    </div>
  );
}
