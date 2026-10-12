'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatBRL, formatBrDate, type OpportunityRow, type PipelineRow, type PipelineStageRow } from '@siow/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Empty, useToast } from '@/components/ui';
import { errMsg } from './opportunity-form';

interface Board { pipeline: PipelineRow; columns: Array<{ stage: PipelineStageRow; items: OpportunityRow[]; amount: string }> }

/** Kanban do funil: arrastar entre etapas em andamento; "Ganho"/"Perdido" só pelas ações da oportunidade (regra do PROMPT). */
export function Kanban({ pipelineId, ownerUserId, onWin, onLose }: { pipelineId?: string; ownerUserId?: string; onWin: (o: OpportunityRow) => void; onLose: (o: OpportunityRow) => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useAuth();
  const [toast, showToast] = useToast();
  const [over, setOver] = useState<string | null>(null);
  const { data } = useQuery({ queryKey: ['crm-board', pipelineId, ownerUserId], queryFn: () => api<Board>('/comercial/opportunities/board', { query: { pipelineId, ownerUserId } }) });
  const move = useMutation({
    mutationFn: (v: { id: string; stageId: string }) => api(`/comercial/opportunities/${v.id}/move`, { method: 'POST', body: { stageId: v.stageId } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['crm-board'] }); void qc.invalidateQueries({ queryKey: ['crm-dashboard'] }); },
    onError: (e) => showToast(errMsg(e)),
  });
  if (!data) return <div className="muted small">Carregando funil…</div>;
  const drop = (stage: PipelineStageRow, e: React.DragEvent): void => {
    e.preventDefault(); setOver(null);
    const id = e.dataTransfer.getData('text/opportunity'); if (!id || !can('crm.write')) return;
    const item = data.columns.flatMap((c) => c.items).find((i) => i.id === id); if (!item || item.stage.id === stage.id) return;
    if (stage.kind === 'WON') { onWin(item); return; }
    if (stage.kind === 'LOST') { onLose(item); return; }
    if (item.status !== 'OPEN') { showToast('Reabra a oportunidade antes de mover'); return; }
    move.mutate({ id, stageId: stage.id });
  };
  return (
    <div className="kanban">
      {data.columns.map(({ stage, items, amount }) => (
        <div key={stage.id} className={`kcol ${stage.kind === 'WON' ? 'won' : stage.kind === 'LOST' ? 'lost' : ''} ${over === stage.id ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); if (over !== stage.id) setOver(stage.id); }} onDragLeave={() => setOver(null)} onDrop={(e) => drop(stage, e)}>
          <div className="kh"><b>{stage.name}</b><span className="small muted">{items.length} · {formatBRL(amount)}</span></div>
          <div className="kb">
            {items.length === 0 && <div className="small muted" style={{ textAlign: 'center', padding: '12px 0' }}>{stage.kind === 'OPEN' ? 'Arraste para cá' : 'Últimos 30 dias'}</div>}
            {items.map((o) => (
              <div key={o.id} className={`kcard ${o.stalled ? 'stalled' : ''}`} draggable={can('crm.write')} onDragStart={(e) => e.dataTransfer.setData('text/opportunity', o.id)} onClick={() => router.push(`/comercial/oportunidades/${o.id}`)} title={o.stalled ? `Parada há ${o.daysInStage} dias` : `${o.daysInStage} dia(s) na etapa`}>
                <div className="t">{o.title}</div>
                <div className="e">{o.entity.shortName ?? o.entity.name} · {o.entity.municipality}/{o.entity.uf}</div>
                <div className="f">
                  <span className="num">{o.totalAmount ? formatBRL(o.totalAmount) : '—'}</span>
                  <span>{o.nextTask ? <span title={o.nextTask.title} style={{ color: o.nextTask.dueDate < new Date().toISOString().slice(0, 10) ? 'var(--crit)' : undefined }}>📅 {formatBrDate(o.nextTask.dueDate)}</span> : o.owner?.name?.split(' ')[0] ?? ''}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {data.columns.length === 0 && <Empty>Funil sem etapas</Empty>}
      {toast}
    </div>
  );
}
