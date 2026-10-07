'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { formatBRL, formatBrDate, formatBrDateTime, type EntitySummary } from '@siow/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { InvoicesTable } from '@/components/invoices-table';
import { ContractsPanel } from '@/components/panels/contracts-panel';
import { TasksPanel } from '@/components/panels/tasks-panel';
import { CollectionsPanel } from '@/components/panels/collections-panel';
import { ServiceOrdersPanel } from '@/components/panels/service-orders-panel';
import { CertificatesPanel } from '@/components/panels/certificates-panel';
import { DocumentsPanel } from '@/components/panels/documents-panel';
import { HistoryPanel } from '@/components/panels/history-panel';
import { ContactsPanel } from '@/components/panels/contacts-panel';
import { SyncStatusBadge } from '@/components/status';
import { Button, Card, CardContent, CardHeader, CardTitle, Stat, Tabs } from '@/components/ui';

interface EntityDetail {
  id: string; type: string; name: string; shortName: string | null; municipality: string; uf: string; notes: string | null;
  dataSources: Array<{ id: string; url: string; label: string | null; lastSyncAt: string | null; lastSyncStatus: string | null; syncEnabled: boolean; circuitOpenUntil: string | null }>;
  contracts: Array<{ id: string; number: string; status: string; startDate: string | null; endDate: string | null; monthlyValue: string | null; amendments: Array<{ id: string; label: string | null; sequence: number }> }>;
  overview: EntitySummary | null;
}

const TABS = [
  { key: 'overview', label: 'Visão geral' }, { key: 'invoices', label: 'Notas fiscais' }, { key: 'contracts', label: 'Contratos' }, { key: 'agenda', label: 'Agenda' },
  { key: 'collections', label: 'Cobranças' }, { key: 'orders', label: 'Ordens de serviço' }, { key: 'certificates', label: 'Certidões' }, { key: 'documents', label: 'Documentos' }, { key: 'contacts', label: 'Contatos' }, { key: 'history', label: 'Histórico' },
];

export default function EntityPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState('overview');
  const { data: e } = useQuery({ queryKey: ['entity', id], queryFn: () => api<EntityDetail>(`/financeiro/entities/${id}`) });
  const sync = useMutation({ mutationFn: () => api(`/financeiro/sync/entities/${id}`, { method: 'POST' }), onSuccess: () => setTimeout(() => qc.invalidateQueries({ queryKey: ['entity', id] }), 4000) });

  if (!e) return <div className="text-sm text-ink-3">Carregando…</div>;
  const o = e.overview;
  const activeContract = e.contracts.find((c) => c.status === 'ACTIVE') ?? e.contracts[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs text-ink-3">{e.type} · {e.municipality}/{e.uf}</div>
          <h1 className="text-xl font-semibold">{e.name}</h1>
          <div className="mt-1 flex items-center gap-2 text-xs text-ink-3">
            <SyncStatusBadge status={o?.lastSyncStatus ?? null} />
            {o?.lastSyncAt ? `Última sincronização ${formatBrDateTime(o.lastSyncAt)}` : 'Nunca sincronizada'}
            {e.dataSources[0]?.circuitOpenUntil && new Date(e.dataSources[0].circuitOpenUntil) > new Date() && <span className="text-warn">· sincronização automática pausada após falhas</span>}
          </div>
        </div>
        {can('sync.run') && e.dataSources.length > 0 && <Button variant="secondary" onClick={() => sync.mutate()} disabled={sync.isPending}>{sync.isSuccess ? 'Sincronização enfileirada' : 'Sincronizar agora'}</Button>}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Contrato atual" value={activeContract?.number ?? '—'} hint={activeContract ? `${formatBrDate(activeContract.startDate)} a ${formatBrDate(activeContract.endDate)}` : undefined} />
        <Stat label="Aditivos" value={activeContract?.amendments.length ?? 0} hint={activeContract?.amendments.at(-1)?.label ?? undefined} />
        <Stat label="Total em débito" value={formatBRL(o?.debtTotal ?? '0')} tone={Number(o?.debtTotal ?? 0) > 0 ? 'warn' : 'good'} />
        <Stat label="Notas pendentes" value={o?.pendingInvoices ?? 0} />
        <Stat label="Último pagamento" value={o?.lastPaymentAt ? formatBrDate(o.lastPaymentAt) : 'Nunca'} hint={o?.lastPaymentAmount ? formatBRL(o.lastPaymentAmount) : undefined} />
        <Stat label="Última cobrança" value={o?.lastCollectionAt ? formatBrDate(o.lastCollectionAt.slice(0, 10)) : '—'} />
        <Stat label="OS pendentes" value={o?.pendingServiceOrders ?? 0} tone={o?.pendingServiceOrders ? 'warn' : undefined} />
        <Stat label="A verificar" value={o?.needsReconciliation ?? 0} tone={o?.needsReconciliation ? 'critical' : undefined} />
      </div>

      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Fonte de dados</CardTitle></CardHeader>
            <CardContent className="text-sm">
              {e.dataSources.length === 0 ? <p className="text-ink-3">Nenhuma URL cadastrada. Cadastre a URL do Portal do Cliente para habilitar a sincronização.</p> : e.dataSources.map((ds) => (
                <div key={ds.id} className="flex items-center justify-between gap-2 py-1">
                  <a href={ds.url} target="_blank" rel="noopener" className="truncate text-brand hover:underline">{ds.label ?? ds.url}</a>
                  <span className="shrink-0 text-xs text-ink-3">{ds.syncEnabled ? 'automática' : 'manual'}</span>
                </div>
              ))}
              {e.notes && <p className="mt-3 whitespace-pre-wrap text-ink-2">{e.notes}</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Próximas ações</CardTitle></CardHeader>
            <CardContent><TasksPanel entityId={id} compact /></CardContent>
          </Card>
        </div>
      )}
      {tab === 'invoices' && <InvoicesTable base={{ entityId: id }} showEntity={false} />}
      {tab === 'contracts' && <ContractsPanel entityId={id} />}
      {tab === 'agenda' && <TasksPanel entityId={id} />}
      {tab === 'collections' && <CollectionsPanel entityId={id} />}
      {tab === 'orders' && <ServiceOrdersPanel entityId={id} contracts={e.contracts} />}
      {tab === 'certificates' && <CertificatesPanel entityId={id} />}
      {tab === 'documents' && <DocumentsPanel entityId={id} />}
      {tab === 'contacts' && <ContactsPanel entityId={id} />}
      {tab === 'history' && <HistoryPanel entityId={id} />}
    </div>
  );
}
