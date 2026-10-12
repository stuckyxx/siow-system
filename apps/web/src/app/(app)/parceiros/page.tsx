'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PARTNER_KIND_LABELS, formatBRL, type PartnerKind, type PartnerRow } from '@siow/shared';
import { api } from '@/lib/api';
import { PartnerForm, errMsg } from '@/components/crm/partner-form';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Empty, Input, Stat, Table, Td, Th, useToast } from '@/components/ui';


export default function PartnersPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useAuth();
  const [toast, showToast] = useToast();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<PartnerRow | 'new' | null>(null);
  const { data } = useQuery({ queryKey: ['partners', q], queryFn: () => api<PartnerRow[]>('/parceiros', { query: { q: q || undefined } }) });
  const recompute = useMutation({ mutationFn: () => api<{ created: number; updated: number; reversed: number }>('/parceiros/commissions/recompute', { method: 'POST' }), onSuccess: (r) => { showToast(`Comissões recalculadas: ${r.created} nova(s), ${r.updated} atualizada(s), ${r.reversed} estornada(s)`); void qc.invalidateQueries({ queryKey: ['partners'] }); }, onError: (e) => showToast(errMsg(e)) });
  const sum = (k: keyof PartnerRow['totals']) => (data ?? []).reduce((a, p) => a + Number(p.totals[k]), 0).toFixed(2);
  return (
    <div>
      <div className="row between"><div><h1>Parceiros e comissões</h1><p className="sub">Representantes, indicadores e empresas parceiras; regras de remuneração e comissões calculadas sobre o Financeiro (recebimento confirmado).</p></div>
        <div className="row">{can('partners.manage') && <Button variant="secondary" onClick={() => recompute.mutate()} disabled={recompute.isPending}>Recalcular comissões</Button>}{can('partners.manage') && <Button onClick={() => setEditing('new')}>+ Novo parceiro</Button>}</div></div>
      {data && <div className="g4" style={{ margin: '12px 0' }}>
        <Stat label="Previstas" value={formatBRL(sum('forecast'))} hint="notas emitidas ainda não pagas" tone="info" />
        <Stat label="A pagar" value={formatBRL(sum('due'))} hint="recebimento confirmado" tone={Number(sum('due')) > 0 ? 'warn' : 'good'} />
        <Stat label="Pagas" value={formatBRL(sum('paid'))} tone="good" />
        <Stat label="Estornadas" value={formatBRL(sum('reversed'))} hint="notas canceladas ou que voltaram a pendente" />
      </div>}
      <div className="row" style={{ marginBottom: 10 }}><Input placeholder="Buscar parceiro" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 260 }} /></div>
      <div className="card">
        {!data ? <div className="bd small muted">Carregando…</div> : data.length === 0 ? <div className="bd"><Empty>Nenhum parceiro cadastrado</Empty></div> : (
          <div className="tbl"><Table>
            <thead><tr><Th>Parceiro</Th><Th>Tipo</Th><Th className="r">Entidades</Th><Th className="r hide-m">Oportunidades</Th><Th className="r">Regras</Th><Th className="r">Previstas</Th><Th className="r">A pagar</Th><Th className="r hide-m">Pagas</Th><Th>Situação</Th></tr></thead>
            <tbody>{data.map((p) => (
              <tr key={p.id} className="click" onClick={() => router.push(`/parceiros/${p.id}`)}>
                <Td><span className="link">{p.name}</span>{p.contactName && <div className="small muted">{p.contactName}{p.email ? ` · ${p.email}` : ''}</div>}{p.userName && <div className="small muted">portal: {p.userName}</div>}</Td>
                <Td>{PARTNER_KIND_LABELS[p.kind as PartnerKind] ?? p.kind}</Td>
                <Td className="r num">{p.entityCount}</Td><Td className="r num hide-m">{p.opportunityCount}</Td><Td className="r num">{p.ruleCount}</Td>
                <Td className="r num">{formatBRL(p.totals.forecast)}</Td><Td className="r num" style={{ color: Number(p.totals.due) ? 'var(--warn)' : undefined }}>{formatBRL(p.totals.due)}</Td><Td className="r num hide-m">{formatBRL(p.totals.paid)}</Td>
                <Td><Badge tone={p.isActive ? 'good' : 'neutral'}>{p.isActive ? 'Ativo' : 'Inativo'}</Badge></Td>
              </tr>))}</tbody>
          </Table></div>
        )}
      </div>
      {editing && <PartnerForm partner={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(p) => { setEditing(null); void qc.invalidateQueries({ queryKey: ['partners'] }); if (editing === 'new') router.push(`/parceiros/${p.id}`); }} />}
      {toast}
    </div>
  );
}
