'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { formatBrDateTime } from '@siow/shared';
import { api } from '@/lib/api';
import { Badge, Button, Card, Empty } from '@/components/ui';

interface N { id: string; type: string; title: string; body: string | null; entityId: string | null; readAt: string | null; createdAt: string }

export default function NotificationsPage() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['notifications', 'all'], queryFn: () => api<N[]>('/notifications') });
  const readAll = useMutation({ mutationFn: () => api('/notifications/read-all', { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const read = useMutation({ mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: 'PATCH' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><h1 className="text-xl font-semibold">Notificações</h1><Button variant="secondary" onClick={() => readAll.mutate()}>Marcar todas como lidas</Button></div>
      <Card className="divide-y divide-line">
        {!data ? <div className="p-4 text-sm text-ink-3">Carregando…</div> : data.length === 0 ? <div className="p-4"><Empty>Nenhuma notificação</Empty></div> : data.map((n) => (
          <div key={n.id} className={`flex items-start gap-3 p-3 ${n.readAt ? 'opacity-60' : ''}`}>
            <Badge tone={n.type.includes('EXPIRED') || n.type === 'SYNC_FAILED' ? 'critical' : n.type.includes('EXPIRING') || n.type === 'RECONCILIATION_NEEDED' ? 'warn' : 'info'}>{n.type.replace(/_/g, ' ').toLowerCase()}</Badge>
            <div className="min-w-0 flex-1">
              <div className="text-sm">{n.entityId ? <Link href={`/financeiro/entidades/${n.entityId}`} className="hover:underline">{n.title}</Link> : n.title}</div>
              {n.body && <div className="text-xs text-ink-2">{n.body}</div>}
              <div className="text-xs text-ink-3">{formatBrDateTime(n.createdAt)}</div>
            </div>
            {!n.readAt && <Button size="sm" variant="ghost" onClick={() => read.mutate(n.id)}>Lida</Button>}
          </div>
        ))}
      </Card>
    </div>
  );
}
