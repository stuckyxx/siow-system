'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { formatBrDateTime, type Paginated, type SyncStatus } from '@siow/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { SyncStatusBadge } from '@/components/status';
import { Button, Card, CardContent, CardHeader, CardTitle, Empty, Stat, Table, Td, Th } from '@/components/ui';

interface Overview {
  sources: Array<{ id: string; url: string; label: string | null; syncEnabled: boolean; isActive: boolean; lastSyncAt: string | null; lastSyncStatus: SyncStatus | null; lastSuccessAt: string | null; consecutiveFailures: number; circuitOpenUntil: string | null; entity: { id: string; name: string; shortName: string | null; type: string } }>;
  last24h: Record<string, number>;
  queue: Record<string, number>;
  schedule: { pattern: string | null; next: string | null; tz: string | null } | null;
}
interface Run { id: string; status: SyncStatus; trigger: string; queuedAt: string; startedAt: string | null; finishedAt: string | null; durationMs: number | null; stats: Record<string, number> | null; errorMessage: string | null; warnings: string[] | null; entity: { id: string; name: string; shortName: string | null }; requestedBy: { name: string } | null }

/** Monitoramento de sincronizações (spec §6). */
export default function SyncPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { data: o } = useQuery({ queryKey: ['sync-overview'], queryFn: () => api<Overview>('/financeiro/sync/overview'), refetchInterval: 15_000 });
  const { data: runs } = useQuery({ queryKey: ['sync-runs'], queryFn: () => api<Paginated<Run>>('/financeiro/sync/runs', { query: { pageSize: 50 } }), refetchInterval: 15_000 });
  const syncAll = useMutation({ mutationFn: () => api('/financeiro/sync/all', { method: 'POST' }), onSuccess: () => setTimeout(() => qc.invalidateQueries({ queryKey: ['sync-runs'] }), 2000) });
  const syncOne = useMutation({ mutationFn: (entityId: string) => api(`/financeiro/sync/entities/${entityId}`, { method: 'POST' }), onSuccess: () => setTimeout(() => qc.invalidateQueries({ queryKey: ['sync-runs'] }), 2000) });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Sincronização</h1>
        {can('integrations.manage') && <Button onClick={() => syncAll.mutate()} disabled={syncAll.isPending}>Sincronizar todas as entidades</Button>}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Próxima sincronização" value={o?.schedule?.next ? formatBrDateTime(o.schedule.next) : '—'} hint={o?.schedule?.pattern ? `cron ${o.schedule.pattern}` : 'worker parado?'} />
        <Stat label="Na fila / executando" value={`${o?.queue['waiting'] ?? 0} / ${o?.queue['active'] ?? 0}`} />
        <Stat label="Sucesso (24h)" value={o?.last24h['SUCCESS'] ?? 0} tone="good" />
        <Stat label="Parciais (24h)" value={o?.last24h['PARTIAL'] ?? 0} tone={o?.last24h['PARTIAL'] ? 'warn' : undefined} />
        <Stat label="Falhas (24h)" value={o?.last24h['FAILED'] ?? 0} tone={o?.last24h['FAILED'] ? 'critical' : undefined} />
      </div>
      <Card>
        <CardHeader><CardTitle>Fontes de dados</CardTitle></CardHeader>
        <CardContent className="px-0">
          {!o ? <div className="p-4 text-sm text-ink-3">Carregando…</div> : o.sources.length === 0 ? <div className="p-4"><Empty>Nenhuma fonte cadastrada</Empty></div> : (
            <Table>
              <thead><tr><Th>Entidade</Th><Th>URL</Th><Th>Último resultado</Th><Th>Última sincronização</Th><Th>Último sucesso</Th><Th>Falhas seguidas</Th><Th></Th></tr></thead>
              <tbody>
                {o.sources.map((s) => (
                  <tr key={s.id} className="hover:bg-surface">
                    <Td><Link href={`/financeiro/entidades/${s.entity.id}`} className="text-brand hover:underline">{s.entity.shortName ?? s.entity.name}</Link>{!s.syncEnabled && <span className="ml-1 text-xs text-ink-3">(automática desligada)</span>}</Td>
                    <Td className="max-w-xs truncate text-xs text-ink-2">{s.url}</Td>
                    <Td><SyncStatusBadge status={s.lastSyncStatus} />{s.circuitOpenUntil && new Date(s.circuitOpenUntil) > new Date() && <div className="text-xs text-warn">pausada até {formatBrDateTime(s.circuitOpenUntil)}</div>}</Td>
                    <Td className="text-ink-2">{s.lastSyncAt ? formatBrDateTime(s.lastSyncAt) : '—'}</Td>
                    <Td className="text-ink-2">{s.lastSuccessAt ? formatBrDateTime(s.lastSuccessAt) : '—'}</Td>
                    <Td className={s.consecutiveFailures ? 'text-critical' : ''}>{s.consecutiveFailures}</Td>
                    <Td>{can('sync.run') && <Button size="sm" variant="secondary" onClick={() => syncOne.mutate(s.entity.id)}>Sincronizar agora</Button>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Execuções recentes</CardTitle></CardHeader>
        <CardContent className="px-0">
          {!runs ? <div className="p-4 text-sm text-ink-3">Carregando…</div> : runs.items.length === 0 ? <div className="p-4"><Empty>Nenhuma execução</Empty></div> : (
            <Table>
              <thead><tr><Th>Início</Th><Th>Entidade</Th><Th>Disparo</Th><Th>Resultado</Th><Th>Duração</Th><Th>Dados atualizados</Th><Th>Erros / avisos</Th></tr></thead>
              <tbody>
                {runs.items.map((r) => (
                  <tr key={r.id}>
                    <Td className="whitespace-nowrap text-ink-2">{formatBrDateTime(r.startedAt ?? r.queuedAt)}</Td>
                    <Td><Link href={`/financeiro/entidades/${r.entity.id}`} className="hover:underline">{r.entity.shortName ?? r.entity.name}</Link></Td>
                    <Td className="text-ink-2">{r.trigger === 'MANUAL' ? `manual${r.requestedBy ? ` (${r.requestedBy.name})` : ''}` : r.trigger === 'SCHEDULED' ? 'agendada' : r.trigger === 'BULK' ? 'em lote' : r.trigger}</Td>
                    <Td><SyncStatusBadge status={r.status} /></Td>
                    <Td className="tabular-nums">{r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : '—'}</Td>
                    <Td className="text-xs text-ink-2">{r.stats ? `${r.stats['invoicesCreated']} novas · ${r.stats['invoicesUpdated']} atualizadas · ${r.stats['statusChanges']} status · ${r.stats['conflicts']} conflitos · ${r.stats['missing']} ausentes · ${r.stats['certificatesNewVersions']} certidões` : '—'}</Td>
                    <Td className="max-w-md text-xs">{r.errorMessage && <div className="text-critical">{r.errorMessage}</div>}{r.warnings?.slice(0, 3).map((w, i) => <div key={i} className="text-warn">{w}</div>)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
