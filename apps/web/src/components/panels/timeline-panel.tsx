'use client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { formatBrDateTime, type TimelineEvent } from '@siow/shared';
import { api } from '@/lib/api';
import { Badge, Card, Empty } from '../ui';

const MODULE_LABEL: Record<TimelineEvent['module'], string> = { FINANCEIRO: 'Financeiro', CADASTRO: 'Cadastro', SINCRONIZACAO: 'Sincronização', AGENDA: 'Agenda', COBRANCA: 'Cobrança', DOCUMENTOS: 'Documentos', AUDITORIA: 'Auditoria', COMERCIAL: 'Comercial', LICITACOES: 'Licitações', ATENDIMENTO: 'Atendimento' };
const TONE: Record<string, 'critical' | 'warn' | 'good' | 'info' | 'neutral'> = { FAILED: 'critical', CONFLICT_DETECTED: 'critical', MISSING_FROM_SOURCE: 'warn', PARTIAL: 'warn', MANUAL_OVERRIDE: 'warn', SUCCESS: 'good', DONE: 'good', CREATED: 'info', CONTRACT: 'info' };

/** Linha do tempo 360º: tudo que aconteceu com a entidade, de todos os módulos, em ordem cronológica. */
export function TimelinePanel({ entityId }: { entityId: string }) {
  const { data } = useQuery({ queryKey: ['timeline', entityId], queryFn: () => api<TimelineEvent[]>(`/financeiro/entities/${entityId}/timeline`) });
  const [module, setModule] = useState<string>('');
  const modules = [...new Set((data ?? []).map((e) => e.module))];
  const list = module ? (data ?? []).filter((e) => e.module === module) : data ?? [];
  return (
    <div className="space-y-3">
      <div className="seg">
        <button className={module === '' ? 'on' : ''} onClick={() => setModule('')}>Tudo{data ? ` (${data.length})` : ''}</button>
        {modules.map((m) => <button key={m} className={module === m ? 'on' : ''} onClick={() => setModule(m)}>{MODULE_LABEL[m]} ({data!.filter((e) => e.module === m).length})</button>)}
      </div>
      <Card>
        {!data ? <div className="p-6 text-sm text-ink-3">Carregando…</div> : list.length === 0 ? <div className="p-6"><Empty>Nenhum evento registrado</Empty></div> : (
          <div className="bd" style={{ maxHeight: 640, overflow: 'auto' }}>
            {list.map((e) => (
              <div key={e.id} className="att">
                <div className="small muted tabular-nums" style={{ minWidth: 118 }}>{formatBrDateTime(e.occurredAt)}</div>
                <Badge tone={TONE[e.kind] ?? 'neutral'}>{MODULE_LABEL[e.module]}</Badge>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div>{e.title}</div>
                  {(e.detail || e.userName) && <div className="small muted">{[e.detail, e.userName ? `por ${e.userName}` : null].filter(Boolean).join(' · ')}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
