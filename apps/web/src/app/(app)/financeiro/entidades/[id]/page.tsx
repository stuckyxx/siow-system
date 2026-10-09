'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { formatBRL, formatBrDate, formatBrDateTime, type EntitySummary, type InvoiceRow, type Paginated } from '@siow/shared';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { InvoicesTable } from '@/components/invoices-table';
import { InvoiceDialog } from '@/components/invoice-dialog';
import { ContractsPanel } from '@/components/panels/contracts-panel';
import { TasksPanel } from '@/components/panels/tasks-panel';
import { ServiceOrdersPanel } from '@/components/panels/service-orders-panel';
import { ContactsPanel } from '@/components/panels/contacts-panel';
import { SyncStatusBadge } from '@/components/status';
import { Stat, Tabs, useToast } from '@/components/ui';

interface EntityDetail {
  id: string; type: string; name: string; shortName: string | null; municipality: string; uf: string; notes: string | null;
  dataSources: Array<{ id: string; url: string; label: string | null; lastSyncAt: string | null; lastSyncStatus: string | null; syncEnabled: boolean; circuitOpenUntil: string | null }>;
  contracts: Array<{ id: string; number: string; status: string; origin: string; startDate: string | null; endDate: string | null; monthlyValue: string | null; amendments: Array<{ id: string; label: string | null; sequence: number }> }>;
  overview: EntitySummary | null;
}

/** Abas centralizadas do protótipo — somente estas seis. */
const TABS = [
  { key: 'overview', label: 'Visão geral' },
  { key: 'invoices', label: 'Notas fiscais' },
  { key: 'contracts', label: 'Contratos' },
  { key: 'agenda', label: 'Agenda' },
  { key: 'orders', label: 'Ordens de serviço' },
  { key: 'contacts', label: 'Contatos' },
];

export default function EntityPage() {
  return <Suspense fallback={<div className="muted">Carregando…</div>}><EntityView /></Suspense>;
}

function EntityView() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { can } = useAuth();
  const qc = useQueryClient();
  const initial = search.get('tab');
  const [tab, setTabState] = useState(TABS.some((t) => t.key === initial) ? initial! : 'overview');
  const [newTask, setNewTask] = useState(false);
  const [chargeId, setChargeId] = useState<string | null>(null);
  const [toast, showToast] = useToast();
  const { data: e } = useQuery({ queryKey: ['entity', id], queryFn: () => api<EntityDetail>(`/financeiro/entities/${id}`) });

  const setTab = (k: string): void => {
    setTabState(k);
    setNewTask(false);
    router.replace(`/financeiro/entidades/${id}?tab=${k}`, { scroll: false });
  };
  const sync = useMutation({
    mutationFn: () => api<Array<{ status: string }>>(`/financeiro/sync/entities/${id}`, { method: 'POST' }),
    onSuccess: (runs) => {
      const failed = runs.filter((r) => r.status === 'FAILED').length;
      showToast(failed ? 'Sincronização terminou com falha — veja o painel de Sincronização' : 'Sincronização concluída');
      void qc.invalidateQueries({ queryKey: ['entity', id] });
      void qc.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (err) => showToast(err instanceof ApiError ? err.message : 'Falha ao sincronizar'),
  });
  // "Cobrar": abre a cobrança da nota pendente mais antiga (o envio nunca é automático).
  const charge = async (): Promise<void> => {
    const r = await api<Paginated<InvoiceRow>>('/financeiro/invoices', { query: { entityId: id, status: 'PENDING', sortBy: 'issueDate', sortDir: 'asc', pageSize: 1 } });
    if (r.items[0]) setChargeId(r.items[0].id);
    else showToast('Nenhuma nota pendente para cobrar');
  };

  if (!e) return <div className="muted">Carregando…</div>;
  const o = e.overview;
  const active = e.contracts.filter((c) => c.status === 'ACTIVE');
  const current = active.find((c) => c.origin === 'MANUAL') ?? active[0] ?? e.contracts[0];
  const amends = current?.amendments ?? [];
  const circuitOpen = e.dataSources[0]?.circuitOpenUntil && new Date(e.dataSources[0].circuitOpenUntil) > new Date();

  return (
    <div>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="small muted">{e.type} · {e.municipality}/{e.uf}</div>
          <h1>{e.name}</h1>
          <div className="small muted row">
            <SyncStatusBadge status={o?.lastSyncStatus ?? null} />
            {o?.lastSyncAt ? `Última sincronização ${formatBrDateTime(o.lastSyncAt)}` : 'Nunca sincronizada'}
            {circuitOpen && <span style={{ color: 'var(--warn)' }}>· sincronização automática pausada após falhas</span>}
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setTab('invoices')}>Ver pendentes</button>
          {can('tasks.manage') && <button className="btn" onClick={() => { setTabState('agenda'); setNewTask(true); }}>Nova tarefa</button>}
          {can('collections.manage') && <button className="btn" onClick={() => void charge()}>Cobrar</button>}
          {can('sync.run') && e.dataSources.length > 0 && <button className="btn p" onClick={() => sync.mutate()} disabled={sync.isPending}>{sync.isPending ? 'Sincronizando…' : 'Sincronizar agora'}</button>}
        </div>
      </div>

      <div className="g5" style={{ marginTop: 12 }}>
        <Stat small label="Contrato atual" value={current?.number ?? '—'} hint={current?.startDate || current?.endDate ? `${formatBrDate(current.startDate)} a ${formatBrDate(current.endDate)}` : undefined} />
        <Stat small label="Aditivos" value={amends.length} hint={amends.length ? `último: ${amends.at(-1)?.label ?? `${amends.at(-1)?.sequence}º`}` : 'nenhum'} />
        <Stat small label="Total em débito" value={formatBRL(o?.debtTotal ?? '0')} tone={Number(o?.debtTotal ?? 0) > 0 ? 'warn' : 'good'} />
        <Stat small label="Notas pendentes" value={o?.pendingInvoices ?? 0} tone={o?.pendingInvoices ? 'warn' : undefined} onClick={() => setTab('invoices')} />
        <Stat small label="Notas pagas" value={o?.paidInvoices ?? 0} tone="good" hint={o?.paidInvoices ? `${formatBRL(o.paidTotal)} recebidos` : 'nenhum pagamento'} onClick={() => setTab('invoices')} />
        <Stat small label="Total de notas" value={(o?.pendingInvoices ?? 0) + (o?.paidInvoices ?? 0)} hint="pendentes + pagas" onClick={() => setTab('invoices')} />
        <Stat small label="Último pagamento" value={o?.lastPaymentAt ? formatBrDate(o.lastPaymentAt) : 'Nunca'} hint={o?.lastPaymentAmount ? formatBRL(o.lastPaymentAmount) : undefined} tone={o?.lastPaymentAt ? 'good' : undefined} />
        <Stat small label="Última cobrança" value={o?.lastCollectionAt ? formatBrDate(o.lastCollectionAt.slice(0, 10)) : '—'} />
        <Stat small label="OS pendentes" value={o?.pendingServiceOrders ?? 0} tone={o?.pendingServiceOrders ? 'warn' : undefined} />
        <Stat small label="A verificar" value={o?.needsReconciliation ?? 0} tone={o?.needsReconciliation ? 'critical' : undefined} />
      </div>

      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      {tab === 'overview' && (
        <div className="g2">
          <div className="card">
            <div className="hd"><h2>Fonte de dados</h2></div>
            <div className="bd small">
              {e.dataSources.length === 0 ? <p className="muted">Nenhuma URL cadastrada. Cadastre a URL do Portal do Cliente para habilitar a sincronização.</p> : e.dataSources.map((ds) => (
                <div key={ds.id} style={{ marginBottom: 6 }}>
                  <a href={ds.url} target="_blank" rel="noopener noreferrer" style={{ wordBreak: 'break-all' }}>{ds.url}</a>
                  <div className="muted" style={{ marginTop: 4 }}>{ds.syncEnabled ? 'Sincronização automática ativa' : 'Sincronização manual'}{ds.lastSyncAt ? ` · última ${formatBrDateTime(ds.lastSyncAt)}` : ''}</div>
                </div>
              ))}
              {e.notes && <p style={{ whiteSpace: 'pre-wrap', marginTop: 10 }}>{e.notes}</p>}
            </div>
          </div>
          <div className="card">
            <div className="hd"><h2>Próximas ações</h2></div>
            <div className="bd"><TasksPanel entityId={id} compact /></div>
          </div>
        </div>
      )}
      {tab === 'invoices' && <InvoicesTable base={{ entityId: id }} showEntity={false} initialOpenId={search.get('nota')} />}
      {tab === 'contracts' && <ContractsPanel entityId={id} manualOnly />}
      {tab === 'agenda' && <TasksPanel key={newTask ? 'new' : 'list'} entityId={id} autoCreate={newTask} />}
      {tab === 'orders' && <ServiceOrdersPanel entityId={id} contracts={e.contracts} />}
      {tab === 'contacts' && <ContactsPanel entityId={id} />}

      <InvoiceDialog id={chargeId} initialTab="collection" onClose={() => setChargeId(null)} />
      {toast}
    </div>
  );
}
