'use client';
import { useQuery } from '@tanstack/react-query';
import { formatBrDateTime, type Paginated } from '@siow/shared';
import { api } from '@/lib/api';
import { SyncStatusBadge } from '../status';
import { Badge, Card, CardContent, CardHeader, CardTitle, Empty } from '../ui';

interface Run { id: string; status: 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'SKIPPED'; trigger: string; queuedAt: string; finishedAt: string | null; durationMs: number | null; stats: Record<string, number> | null; errorMessage: string | null; warnings: string[] | null; requestedBy: { name: string } | null }
interface Msg { id: string; channel: string; status: string; recipient: string; body: string; createdAt: string; sentAt: string | null; contact: { name: string } | null; sentBy: { name: string } | null; template: { name: string } | null }

/** Histórico da entidade: sincronizações e mensagens enviadas. Alterações de cada nota ficam no histórico da própria nota. */
export function HistoryPanel({ entityId }: { entityId: string }) {
  const { data: runs } = useQuery({ queryKey: ['sync-runs', entityId], queryFn: () => api<Paginated<Run>>('/financeiro/sync/runs', { query: { entityId, pageSize: 20 } }) });
  const { data: msgs } = useQuery({ queryKey: ['messages', entityId], queryFn: () => api<Msg[]>('/financeiro/messages', { query: { entityId } }) });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Sincronizações</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {!runs ? 'Carregando…' : runs.items.length === 0 ? <Empty>Nenhuma sincronização</Empty> : runs.items.map((r) => (
            <div key={r.id} className="rounded-md border border-line p-2">
              <div className="flex items-center gap-2"><SyncStatusBadge status={r.status} /><span className="text-xs text-ink-3">{formatBrDateTime(r.queuedAt)} · {r.trigger === 'MANUAL' ? `manual${r.requestedBy ? ` (${r.requestedBy.name})` : ''}` : r.trigger === 'SCHEDULED' ? 'agendada' : 'em lote'}{r.durationMs ? ` · ${(r.durationMs / 1000).toFixed(1)}s` : ''}</span></div>
              {r.stats && <div className="mt-1 text-xs text-ink-2">{r.stats['invoicesSeen']} notas lidas · {r.stats['invoicesCreated']} novas · {r.stats['invoicesUpdated']} atualizadas · {r.stats['statusChanges']} mudanças de status · {r.stats['conflicts']} conflitos · {r.stats['missing']} ausentes</div>}
              {r.errorMessage && <div className="mt-1 text-xs text-critical">{r.errorMessage}</div>}
              {r.warnings && r.warnings.length > 0 && <ul className="mt-1 list-disc pl-4 text-xs text-warn">{r.warnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}</ul>}
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Mensagens ao cliente</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {!msgs ? 'Carregando…' : msgs.length === 0 ? <Empty>Nenhuma mensagem</Empty> : msgs.map((m) => (
            <div key={m.id} className="rounded-md border border-line p-2">
              <div className="flex items-center gap-2"><Badge tone={m.status === 'SENT' || m.status === 'DELIVERED' || m.status === 'MANUALLY_CONFIRMED' ? 'good' : m.status === 'FAILED' ? 'critical' : 'warn'}>{statusLabel(m.status)}</Badge><span className="text-xs text-ink-3">{formatBrDateTime(m.createdAt)} · {m.channel} · {m.contact?.name ?? m.recipient}{m.sentBy ? ` · ${m.sentBy.name}` : ''}</span></div>
              {m.template && <div className="text-xs text-ink-3">{m.template.name}</div>}
              <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-ink-2">{m.body}</div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function statusLabel(s: string): string {
  return ({ DRAFT: 'Rascunho', MANUAL_PENDING: 'Envio manual pendente', MANUALLY_CONFIRMED: 'Enviada (manual)', QUEUED: 'Na fila', SENT: 'Enviada', DELIVERED: 'Entregue', FAILED: 'Falhou' } as Record<string, string>)[s] ?? s;
}
