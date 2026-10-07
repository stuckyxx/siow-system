'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AGING_BUCKET_LABELS, formatBRL, formatBrDate, formatBrDateTime, type DashboardResponse } from '@siow/shared';
import { api } from '@/lib/api';
import { GlobalFilters, type Filters } from '@/components/global-filters';
import { Badge, Card, CardContent, CardHeader, CardTitle, Empty, Skeleton, Stat, Table, Td, Th } from '@/components/ui';

const money = (v: number): string => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} mil` : v.toFixed(0));
const compLabel = (c: string): string => `${c.slice(5, 7)}/${c.slice(2, 4)}`;

export default function DashboardPage() {
  const [filters, setFilters] = useState<Filters>({});
  const { data, isLoading } = useQuery({ queryKey: ['dashboard', filters], queryFn: () => api<DashboardResponse>('/financeiro/dashboard', { query: filters as Record<string, string | number | undefined> }) });

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold">Central financeira</h1>
          <p className="text-sm text-ink-3">{data ? `Atualizado ${formatBrDateTime(data.generatedAt)}` : 'Carregando…'}</p>
        </div>
      </div>
      <GlobalFilters value={filters} onChange={setFilters} />

      {isLoading || !data ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">{Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Total a receber" value={formatBRL(data.cards.totalReceivable)} tone={Number(data.cards.totalReceivable) > 0 ? 'warn' : undefined} />
            <Stat label="Total recebido" value={formatBRL(data.cards.totalReceived)} tone="good" />
            <Stat label="Notas pendentes" value={data.cards.pendingInvoices} />
            <Stat label="Notas pagas" value={data.cards.paidInvoices} />
            <Stat label="Entidades com pendências" value={data.cards.entitiesWithDebt} />
            <Stat label="Contratos ativos" value={data.cards.activeContracts} />
            <Stat label="Contratos vencendo" value={data.cards.contractsExpiring} tone={data.cards.contractsExpiring ? 'warn' : undefined} />
            <Stat label="Certidões vencendo" value={data.cards.certificatesExpiring} tone={data.cards.certificatesExpiring ? 'warn' : undefined} />
            <Stat label="Notas a verificar" value={data.cards.needsReconciliation} tone={data.cards.needsReconciliation ? 'critical' : undefined} hint="divergências com a fonte" />
            <Stat label="Total de débitos" value={formatBRL(data.cards.totalDebt)} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Recebimentos por mês</CardTitle><span className="text-xs text-ink-3">valores pagos, por mês do pagamento</span></CardHeader>
              <CardContent className="h-64">
                {data.monthly.length === 0 ? <Empty>Sem dados no período</Empty> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.monthly.map((m) => ({ ...m, received: Number(m.received), label: compLabel(m.competence) }))} margin={{ left: 0, right: 8, top: 8 }}>
                      <CartesianGrid vertical={false} stroke="#e5e7eb" />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
                      <YAxis tickFormatter={money} tickLine={false} axisLine={false} fontSize={11} width={48} />
                      <Tooltip formatter={(v: number) => formatBRL(v)} labelFormatter={(l) => `Mês ${l}`} />
                      <Bar dataKey="received" name="Recebido" fill="#2a78d6" radius={[4, 4, 0, 0]} maxBarSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Débitos por competência</CardTitle><span className="text-xs text-ink-3">valores ainda pendentes</span></CardHeader>
              <CardContent className="h-64">
                {data.monthly.length === 0 ? <Empty>Sem dados no período</Empty> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.monthly.map((m) => ({ ...m, pending: Number(m.pending), label: compLabel(m.competence) }))} margin={{ left: 0, right: 8, top: 8 }}>
                      <CartesianGrid vertical={false} stroke="#e5e7eb" />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
                      <YAxis tickFormatter={money} tickLine={false} axisLine={false} fontSize={11} width={48} />
                      <Tooltip formatter={(v: number) => formatBRL(v)} labelFormatter={(l) => `Competência ${l}`} />
                      <Line type="monotone" dataKey="pending" name="Pendente" stroke="#eb6834" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader><CardTitle>Tempo de atraso</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <thead><tr><Th>Faixa</Th><Th className="text-right">Notas</Th><Th className="text-right">Valor</Th></tr></thead>
                  <tbody>
                    {data.aging.map((a) => (
                      <tr key={a.bucket}><Td>{AGING_BUCKET_LABELS[a.bucket]}</Td><Td className="text-right tabular-nums">{a.count}</Td><Td className="text-right tabular-nums">{formatBRL(a.amount)}</Td></tr>
                    ))}
                  </tbody>
                </Table>
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle>Entidades com maiores débitos</CardTitle></CardHeader>
              <CardContent>
                {data.topDebtors.length === 0 ? <Empty>Nenhuma pendência</Empty> : (
                  <Table>
                    <thead><tr><Th>Entidade</Th><Th>Município/UF</Th><Th className="text-right">Notas</Th><Th className="text-right">Débito</Th><Th className="text-right">Mais antiga</Th></tr></thead>
                    <tbody>
                      {data.topDebtors.slice(0, 10).map((d) => (
                        <tr key={d.entityId}>
                          <Td><Link className="text-brand hover:underline" href={`/financeiro/entidades/${d.entityId}`}>{d.entityName}</Link></Td>
                          <Td className="text-ink-2">{d.municipality}/{d.uf}</Td>
                          <Td className="text-right tabular-nums">{d.pendingInvoices}</Td>
                          <Td className="text-right tabular-nums font-medium">{formatBRL(d.debt)}</Td>
                          <Td className="text-right tabular-nums text-ink-2">{d.oldestPendingDays ?? '—'} dias</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Últimos pagamentos</CardTitle></CardHeader>
              <CardContent>
                {data.recentPayments.length === 0 ? <Empty>Nenhum pagamento no período</Empty> : (
                  <Table>
                    <thead><tr><Th>Data</Th><Th>Entidade</Th><Th>Nota</Th><Th className="text-right">Valor</Th></tr></thead>
                    <tbody>
                      {data.recentPayments.map((p) => (
                        <tr key={p.invoiceId}>
                          <Td className="tabular-nums">{formatBrDate(p.paidAt)}</Td>
                          <Td><Link className="text-brand hover:underline" href={`/financeiro/entidades/${p.entityId}`}>{p.entityName}</Link></Td>
                          <Td className="text-ink-2">{p.number} · {p.competence.split('-').reverse().join('/')}</Td>
                          <Td className="text-right tabular-nums">{formatBRL(p.amount)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Pendências que precisam de atenção</CardTitle><Badge tone="neutral">{data.attention.length}</Badge></CardHeader>
              <CardContent className="max-h-96 space-y-2 overflow-y-auto">
                {data.attention.length === 0 ? <Empty>Tudo em dia</Empty> : data.attention.map((a, i) => (
                  <div key={`${a.kind}-${a.referenceId ?? i}`} className="flex items-start gap-3 rounded-md border border-line p-2">
                    <Badge tone={a.severity === 'high' ? 'critical' : a.severity === 'warning' ? 'warn' : 'info'}>{labelKind(a.kind)}</Badge>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{a.entityId ? <Link href={`/financeiro/entidades/${a.entityId}`} className="hover:underline">{a.title}</Link> : a.title}</div>
                      <div className="text-xs text-ink-3">{a.detail}</div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function labelKind(kind: string): string {
  return ({ OLD_INVOICE: 'Nota antiga', SERVICE_ORDER_PENDING: 'OS', CERTIFICATE_EXPIRING: 'Certidão', CERTIFICATE_EXPIRED: 'Certidão', CONTRACT_EXPIRING: 'Contrato', COLLECTION_OVERDUE: 'Cobrança', RECONCILIATION: 'Verificar', SYNC_FAILED: 'Sync', MISSING_INVOICE: 'Sem nota' } as Record<string, string>)[kind] ?? kind;
}
