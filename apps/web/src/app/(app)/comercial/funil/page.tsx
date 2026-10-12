'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { PipelineStageRow } from '@siow/shared';
import { api } from '@/lib/api';
import { Button, Input, Select, useToast } from '@/components/ui';
import { errMsg, usePipelines } from '@/components/crm/opportunity-form';

type Draft = { id?: string; name: string; probability: string; kind: 'OPEN' | 'WON' | 'LOST'; slaDays: string };
const fromStage = (s: PipelineStageRow): Draft => ({ id: s.id, name: s.name, probability: String(s.probability), kind: s.kind, slaDays: s.slaDays ? String(s.slaDays) : '' });

/** Configuração do funil (nome e etapas): ordem, probabilidade, tipo e SLA em dias (oportunidade "parada"). */
export default function PipelinePage() {
  const qc = useQueryClient();
  const pipelines = usePipelines();
  const p = pipelines?.[0];
  const [toast, showToast] = useToast();
  const [name, setName] = useState('');
  const [stages, setStages] = useState<Draft[]>([]);
  useEffect(() => { if (p && stages.length === 0) { setName(p.name); setStages(p.stages.map(fromStage)); } }, [p, stages.length]);
  const save = useMutation({
    mutationFn: () => api(`/comercial/pipelines/${p!.id}`, { method: 'PATCH', body: { name, stages: stages.map((s) => ({ id: s.id, name: s.name, probability: Number(s.probability) || 0, kind: s.kind, slaDays: s.slaDays ? Number(s.slaDays) : null })) } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['pipelines'] }); void qc.invalidateQueries({ queryKey: ['crm-board'] }); showToast('Funil salvo'); },
    onError: (e) => showToast(errMsg(e)),
  });
  const set = (i: number, patch: Partial<Draft>): void => setStages(stages.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const swap = (i: number, j: number): void => { if (j < 0 || j >= stages.length) return; const c = [...stages]; [c[i], c[j]] = [c[j]!, c[i]!]; setStages(c); };
  if (!p) return <div className="muted">Carregando…</div>;
  return (
    <div>
      <Link href="/comercial" className="btn sm" style={{ marginBottom: 10 }}>← Comercial</Link>
      <div className="row between"><div><h1>Configurar funil</h1><p className="sub">Etapas na ordem do processo. Probabilidade alimenta a previsão ponderada; SLA (dias) define quando a oportunidade é considerada parada. Exatamente uma etapa "Ganho" e uma "Perdido".</p></div><Button onClick={() => save.mutate()} disabled={save.isPending}>Salvar funil</Button></div>
      <div className="card"><div className="bd">
        <div className="row" style={{ marginBottom: 10 }}><label className="small muted">Nome do funil</label><Input value={name} onChange={(e) => setName(e.target.value)} style={{ maxWidth: 320 }} /></div>
        {stages.map((s, i) => (
          <div key={s.id ?? `n${i}`} className="row" style={{ marginBottom: 6, gap: 6 }}>
            <span className="small muted" style={{ width: 22 }}>{i + 1}.</span>
            <Input value={s.name} onChange={(e) => set(i, { name: e.target.value })} style={{ width: 220 }} />
            <Select value={s.kind} onChange={(e) => set(i, { kind: e.target.value as Draft['kind'] })} style={{ width: 150 }}><option value="OPEN">Em andamento</option><option value="WON">Ganho</option><option value="LOST">Perdido</option></Select>
            {s.kind === 'OPEN' && <><Input type="number" min={0} max={100} value={s.probability} onChange={(e) => set(i, { probability: e.target.value })} style={{ width: 90 }} title="Probabilidade %" /><span className="small muted">%</span><Input type="number" min={1} max={365} value={s.slaDays} onChange={(e) => set(i, { slaDays: e.target.value })} style={{ width: 90 }} placeholder="SLA" title="Dias sem movimentação para alertar" /><span className="small muted">dias</span></>}
            <Button size="sm" variant="ghost" onClick={() => swap(i, i - 1)}>↑</Button><Button size="sm" variant="ghost" onClick={() => swap(i, i + 1)}>↓</Button>
            <Button size="sm" variant="ghost" onClick={() => setStages(stages.filter((_, j) => j !== i))}>Remover</Button>
          </div>
        ))}
        <Button size="sm" variant="secondary" onClick={() => setStages([...stages, { name: 'Nova etapa', probability: '50', kind: 'OPEN', slaDays: '15' }])}>+ Etapa</Button>
      </div></div>
      {toast}
    </div>
  );
}
