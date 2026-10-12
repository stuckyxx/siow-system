'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { GOAL_METRICS, GOAL_METRIC_LABELS, formatBRL, todayIso, type GoalMetric, type GoalRow } from '@siow/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAssignees } from '@/components/panels/tasks-panel';
import { Button, Dialog, Empty, Field, Input, Select, Table, Td, Th, useToast } from '@/components/ui';
import { errMsg } from '@/components/crm/opportunity-form';

export default function GoalsPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [toast, showToast] = useToast();
  const [editing, setEditing] = useState<GoalRow | 'new' | null>(null);
  const { data } = useQuery({ queryKey: ['goals'], queryFn: () => api<GoalRow[]>('/comercial/goals') });
  const remove = useMutation({ mutationFn: (id: string) => api(`/comercial/goals/${id}`, { method: 'DELETE' }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['goals'] }), onError: (e) => showToast(errMsg(e)) });
  const fmt = (g: GoalRow, v: string): string => (g.metric === 'WON_AMOUNT' ? formatBRL(v) : String(Number(v)));
  return (
    <div>
      <Link href="/comercial" className="btn sm" style={{ marginBottom: 10 }}>← Comercial</Link>
      <div className="row between"><div><h1>Metas comerciais</h1><p className="sub">Por período, individuais ou da equipe. A apuração é calculada a partir das oportunidades ganhas e das atividades concluídas.</p></div>{can('crm.manage') && <Button onClick={() => setEditing('new')}>+ Nova meta</Button>}</div>
      <div className="card">
        {!data ? <div className="bd small muted">Carregando…</div> : data.length === 0 ? <div className="bd"><Empty>Nenhuma meta cadastrada</Empty></div> : (
          <div className="tbl"><Table><thead><tr><Th>Meta</Th><Th>Quem</Th><Th>Período</Th><Th className="r">Alvo</Th><Th className="r">Realizado</Th><Th style={{ width: 160 }}>Progresso</Th><Th /></tr></thead><tbody>
            {data.map((g) => <tr key={g.id}><Td>{g.label ?? GOAL_METRIC_LABELS[g.metric as GoalMetric]}<div className="small muted">{GOAL_METRIC_LABELS[g.metric as GoalMetric]}</div></Td><Td>{g.userName ?? 'Equipe'}</Td><Td className="small">{g.periodStart.split('-').reverse().join('/')} a {g.periodEnd.split('-').reverse().join('/')}</Td><Td className="r num">{fmt(g, g.target)}</Td><Td className="r num">{fmt(g, g.achieved)}</Td><Td><div className="goal"><i style={{ width: `${Math.min(100, g.percent)}%` }} /></div><div className="small muted">{g.percent}%</div></Td><Td className="r">{can('crm.manage') && <><Button size="sm" variant="ghost" onClick={() => setEditing(g)}>Editar</Button><Button size="sm" variant="ghost" onClick={() => { if (confirm('Excluir meta?')) remove.mutate(g.id); }}>Excluir</Button></>}</Td></tr>)}
          </tbody></Table></div>
        )}
      </div>
      {editing && <GoalForm goal={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void qc.invalidateQueries({ queryKey: ['goals'] }); void qc.invalidateQueries({ queryKey: ['crm-dashboard'] }); }} />}
      {toast}
    </div>
  );
}

function GoalForm({ goal, onClose, onSaved }: { goal: GoalRow | null; onClose: () => void; onSaved: () => void }) {
  const { data: assignees } = useAssignees();
  const t = todayIso();
  const [f, setF] = useState({ userId: goal?.userId ?? '', metric: goal?.metric ?? 'WON_AMOUNT', periodStart: goal?.periodStart ?? `${t.slice(0, 7)}-01`, periodEnd: goal?.periodEnd ?? new Date(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)), 0)).toISOString().slice(0, 10), target: goal?.target.replace('.', ',') ?? '', label: goal?.label ?? '' });
  const [error, setError] = useState<string | null>(null);
  const b = (k: keyof typeof f) => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value }) });
  const m = useMutation({ mutationFn: () => { const body = { ...f, userId: f.userId || null, label: f.label || null }; return goal ? api(`/comercial/goals/${goal.id}`, { method: 'PUT', body }) : api('/comercial/goals', { method: 'POST', body }); }, onSuccess: onSaved, onError: (e) => setError(errMsg(e)) });
  return (
    <Dialog open onClose={onClose} title={goal ? 'Editar meta' : 'Nova meta'}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Indicador"><Select {...b('metric')}>{GOAL_METRICS.map((x) => <option key={x} value={x}>{GOAL_METRIC_LABELS[x]}</option>)}</Select></Field>
        <Field label="Responsável (vazio = equipe)"><Select {...b('userId')}><option value="">Equipe</option>{assignees?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
        <Field label="Início"><Input type="date" {...b('periodStart')} /></Field>
        <Field label="Fim"><Input type="date" {...b('periodEnd')} /></Field>
        <Field label={f.metric === 'WON_AMOUNT' ? 'Alvo (R$)' : 'Alvo (quantidade)'}><Input {...b('target')} /></Field>
        <Field label="Rótulo (opcional)"><Input {...b('label')} placeholder="Meta do trimestre" /></Field>
      </div>
      {error && <div className="alert crit" style={{ marginTop: 10 }}>{error}</div>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => m.mutate()} disabled={m.isPending || !f.target}>Salvar</Button></div>
    </Dialog>
  );
}
