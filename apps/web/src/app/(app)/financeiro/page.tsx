'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatBRL, formatBrDate, formatBrDateTime, type DashboardResponse } from '@siow/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { GlobalFilters, useGlobalFilters } from '@/components/global-filters';
import { Badge, Dialog, Empty, Skeleton, Stat } from '@/components/ui';

interface ForecastRow { entityId: string; entityShort: string; contractId: string; contractNumber: string; lastInvoice: { number: string; competence: string; issuedAt: string | null } | null; monthly: string; annual: string }
type Dashboard = DashboardResponse & { forecastMonthly: string; forecastAnnual: string; forecastRows: ForecastRow[] };

const comp = (c: string): string => `${c.slice(5, 7)}/${c.slice(0, 4)}`;
const KIND: Record<string, string> = { OLD_INVOICE: 'Nota antiga', SERVICE_ORDER_PENDING: 'OS', CERTIFICATE_EXPIRING: 'Certidão', CERTIFICATE_EXPIRED: 'Certidão', CONTRACT_EXPIRING: 'Contrato', COLLECTION_OVERDUE: 'Cobrança', RECONCILIATION: 'Verificar', SYNC_FAILED: 'Sincronização', MISSING_INVOICE: 'Sem nota' };

export default function DashboardPage() {
  const router = useRouter();
  const { can } = useAuth();
  const [filters, setFilters] = useGlobalFilters();
  const [forecastOpen, setForecastOpen] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['dashboard', filters], queryFn: () => api<Dashboard>('/financeiro/dashboard', { query: filters as Record<string, string | number | undefined> }) });
  // Chips de alerta do protótipo: contratos vencendo em 120 dias.
  const { data: expiring } = useQuery({
    queryKey: ['contracts-expiring-120', filters.entityId],
    queryFn: () => api<Array<{ id: string; entity?: { id: string } }>>('/financeiro/contracts', { query: { expiringDays: 120, entityId: filters.entityId } }),
    enabled: can('contracts.read'),
  });

  const pendingOs = data?.attention.filter((a) => a.kind === 'SERVICE_ORDER_PENDING').length ?? 0;

  return (
    <div>
      <div className="row between">
        <div>
          <h1>Central financeira</h1>
          <p className="sub">{data ? `Atualizado ${formatBrDateTime(data.generatedAt)} · ${data.cards.pendingInvoices + data.cards.paidInvoices} notas no recorte` : 'Carregando…'}</p>
        </div>
      </div>
      <GlobalFilters value={filters} onChange={setFilters} />

      {isLoading || !data ? (
        <div className="g7">{Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-[86px]" />)}</div>
      ) : (
        <>
          <div className="g7">
            <Stat label="Total de entidades" value={data.cards.totalEntities} tone="info" hint={`${data.cards.entitiesSynced} sincronizada(s) · ${data.cards.entitiesWithoutSource} sem link`} onClick={() => router.push('/financeiro/entidades')} />
            <Stat label="Total pendente" value={formatBRL(data.cards.totalReceivable)} tone={data.cards.pendingInvoices ? 'warn' : 'good'} hint={`${data.cards.pendingInvoices} nota(s) pendente(s)`} />
            <Stat label="Total recebido" value={formatBRL(data.cards.totalReceived)} tone="good" hint={`${data.cards.paidInvoices} nota(s) paga(s)`} />
            <Stat label="Receita prevista mensal" value={formatBRL(data.forecastMonthly)} tone="info" hint={`${data.forecastRows.length} contrato(s) ativo(s)`} />
            <Stat label="Receita prevista anual" value={formatBRL(data.forecastAnnual)} tone="info" hint="clique para detalhar" onClick={() => setForecastOpen(true)} />
            <Stat label="Entidades com pendências" value={data.cards.entitiesWithDebt} tone={data.cards.entitiesWithDebt ? 'warn' : 'good'} hint={`de ${data.cards.totalEntities} cadastrada(s)`} />
            <Stat label="Contratos ativos" value={data.cards.activeContracts} hint={`em ${data.cards.entitiesWithActiveContract} entidade(s)`} onClick={() => router.push('/financeiro/contratos')} />
          </div>

          <div className="alerts">
            {data.cards.needsReconciliation > 0 && <Link className="crit" href="/financeiro/notas">⚠ <b>{data.cards.needsReconciliation}</b> nota(s) a verificar</Link>}
            {(expiring?.length ?? 0) > 0 && <Link className="warn" href="/financeiro/contratos"><b>{expiring!.length}</b> contrato(s) vencendo em 120 dias</Link>}
            {data.cards.certificatesExpiring > 0 && <Link className="warn" href="/financeiro/certidoes"><b>{data.cards.certificatesExpiring}</b> certidão(ões) vencendo em 30 dias</Link>}
            {pendingOs > 0 && <Link className="warn" href="/financeiro/ordens-de-servico"><b>{pendingOs}</b> OS pendente(s)</Link>}
            {!data.cards.needsReconciliation && !expiring?.length && !data.cards.certificatesExpiring && !pendingOs && <span className="pill good">Nenhum alerta</span>}
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <div className="hd"><h2>Entidades com maiores débitos</h2></div>
            {data.topDebtors.length === 0 ? <div className="bd"><Empty>Nenhuma pendência no recorte</Empty></div> : (
              <div className="tbl">
                <table>
                  <thead><tr><th>Entidade</th><th className="hide-m">Município/UF</th><th className="r">Notas</th><th className="r">Débito</th><th className="r">Mais antiga</th></tr></thead>
                  <tbody>
                    {data.topDebtors.slice(0, 15).map((d) => (
                      <tr key={d.entityId} className="click" onClick={() => router.push(`/financeiro/entidades/${d.entityId}?tab=invoices`)}>
                        <td><span className="link">{d.entityName}</span></td>
                        <td className="muted hide-m">{d.municipality}/{d.uf}</td>
                        <td className="r num">{d.pendingInvoices}</td>
                        <td className="r num" style={{ color: 'var(--warn)', fontWeight: 600 }}>{formatBRL(d.debt)}</td>
                        <td className="r num muted">{d.oldestPendingDays ?? '—'} dias</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="g2" style={{ marginTop: 12 }}>
            <div className="card">
              <div className="hd"><h2>Últimos pagamentos</h2></div>
              {data.recentPayments.length === 0 ? <div className="bd"><Empty>Nenhum pagamento no recorte</Empty></div> : (
                <div className="tbl">
                  <table>
                    <thead><tr><th>Data</th><th>Entidade</th><th className="hide-m">Nota</th><th className="r">Valor</th></tr></thead>
                    <tbody>
                      {data.recentPayments.slice(0, 8).map((p) => (
                        <tr key={p.invoiceId}>
                          <td className="num">{formatBrDate(p.paidAt)}</td>
                          <td><Link href={`/financeiro/entidades/${p.entityId}`}>{p.entityName}</Link></td>
                          <td className="muted hide-m">{p.number} · {comp(p.competence)}</td>
                          <td className="r num">{formatBRL(p.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="card">
              <div className="hd"><h2>Pendências que precisam de atenção</h2><Badge tone="neutral">{data.attention.length}</Badge></div>
              <div className="bd" style={{ maxHeight: 340, overflow: 'auto' }}>
                {data.attention.length === 0 ? <Empty>Tudo em dia</Empty> : data.attention.map((a, i) => (
                  <div key={`${a.kind}-${a.referenceId ?? i}`} className="att">
                    <Badge tone={a.severity === 'high' ? 'critical' : a.severity === 'warning' ? 'warn' : 'info'}>{KIND[a.kind] ?? a.kind}</Badge>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div>{a.entityId ? <Link href={`/financeiro/entidades/${a.entityId}`}>{a.title}</Link> : a.title}</div>
                      <div className="small muted">{a.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <Dialog open={forecastOpen} onClose={() => setForecastOpen(false)} title="Receita prevista anual" wide>
            <p className="small muted" style={{ marginTop: 0 }}>
              Valor mensal de cada contrato ativo = valor da nota mais recente emitida no Portal do Cliente (primeira da lista). Anual = mensal × 12.
              {filters.entityId || filters.entityType ? ' Respeita os filtros aplicados.' : ''}
            </p>
            <div className="g2" style={{ margin: '10px 0' }}>
              <Stat label="Receita prevista mensal" value={formatBRL(data.forecastMonthly)} tone="info" hint={`${data.forecastRows.length} contrato(s) ativo(s)`} />
              <Stat label="Receita prevista anual" value={formatBRL(data.forecastAnnual)} tone="info" hint="mensal × 12" />
            </div>
            <div className="card tbl" style={{ maxHeight: '52vh', overflow: 'auto' }}>
              <table>
                <thead><tr><th>Entidade</th><th>Contrato</th><th>Nota-base</th><th className="r">Mensal</th><th className="r">Anual</th></tr></thead>
                <tbody>
                  {data.forecastRows.map((r) => (
                    <tr key={r.contractId}>
                      <td>{r.entityShort}</td>
                      <td className="num">{r.contractNumber}</td>
                      <td className="small">{r.lastInvoice ? <>NF {r.lastInvoice.number} · {comp(r.lastInvoice.competence)} <span className="muted">· emitida {formatBrDate(r.lastInvoice.issuedAt)}</span></> : <span className="muted">sem nota — valor contratual</span>}</td>
                      <td className="r num">{formatBRL(r.monthly)}</td>
                      <td className="r num">{formatBRL(r.annual)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
              {can('reports.read') && <button className="btn" onClick={() => router.push('/financeiro/relatorios?r=forecast')}>Ver como relatório</button>}
              <button className="btn p" onClick={() => setForecastOpen(false)}>Fechar</button>
            </div>
          </Dialog>
        </>
      )}
    </div>
  );
}
