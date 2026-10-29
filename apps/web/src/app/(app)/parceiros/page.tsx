'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PARTNER_KIND_LABELS, formatBRL, todayIso, type PartnerKind, type PartnerRow } from '@siow/shared';
import { api } from '@/lib/api';
import { PartnerForm, errMsg } from '@/components/crm/partner-form';
import { PaymentPicker, paymentToast } from '@/components/crm/partner-payment-form';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Empty, Input, Stat, Table, Td, Th, useToast } from '@/components/ui';


export default function PartnersPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useAuth();
  const [toast, showToast] = useToast();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<PartnerRow | 'new' | null>(null);
  const [paying, setPaying] = useState(false);
  const { data } = useQuery({ queryKey: ['partners', q], queryFn: () => api<PartnerRow[]>('/parceiros', { query: { q: q || undefined } }) });
  const recompute = useMutation({ mutationFn: () => api<{ created: number; updated: number; reversed: number }>('/parceiros/commissions/recompute', { method: 'POST' }), onSuccess: (r) => { showToast(`Comissões recalculadas: ${r.created} nova(s), ${r.updated} atualizada(s), ${r.reversed} estornada(s)`); void qc.invalidateQueries({ queryKey: ['partners'] }); }, onError: (e) => showToast(errMsg(e)) });
  // Cartões do exercício atual: previsto = mensalidade × meses até o mês atual; em aberto = previsto − pago (por parceiro, sem negativos).
  const months = Number(todayIso().slice(5, 7));
  const rows = data ?? [];
  const monthly = rows.reduce((a, p) => a + Number(p.monthlyTotal), 0);
  const expectedYear = monthly * months;
  const paidYear = rows.reduce((a, p) => a + Number(p.paidThisYear), 0);
  const openYear = rows.reduce((a, p) => a + Math.max(0, Number(p.monthlyTotal) * months - Number(p.paidThisYear)), 0);
  const paidMonth = rows.reduce((a, p) => a + Number(p.paidThisMonth), 0);
  const year = todayIso().slice(0, 4);
  return (
    <div>
      <div className="row between"><div><h1>Parceiros e comissões</h1><p className="sub">Representantes, indicadores e empresas parceiras; regras de remuneração e comissões calculadas sobre o Financeiro (recebimento confirmado).</p></div>
        <div className="row">{can('partners.manage') && <Button variant="secondary" onClick={() => recompute.mutate()} disabled={recompute.isPending}>Recalcular comissões</Button>}{can('partners.manage') && <Button variant="secondary" onClick={() => setPaying(true)} disabled={!data?.length}>+ Registrar pagamento</Button>}{can('partners.manage') && <Button onClick={() => setEditing('new')}>+ Novo parceiro</Button>}</div></div>
      {data && <div className="g5" style={{ margin: '12px 0' }}>
        <Stat label={`Previsto ${year}`} value={formatBRL(expectedYear.toFixed(2))} hint={`mensalidade total × ${months} ${months === 1 ? 'mês' : 'meses'}`} tone="info" />
        <Stat label={`Pago ${year}`} value={formatBRL(paidYear.toFixed(2))} hint="pagamentos registrados dos parceiros" tone="good" />
        <Stat label="Em aberto" value={formatBRL(openYear.toFixed(2))} hint="previsto − pago, por parceiro" tone={openYear > 0 ? 'warn' : 'good'} />
        <Stat label="Pago no mês" value={formatBRL(paidMonth.toFixed(2))} hint={`de ${formatBRL(monthly.toFixed(2))} previstos no mês`} tone={paidMonth >= monthly && monthly > 0 ? 'good' : undefined} />
        <Stat label="Valor mensal" value={formatBRL(monthly.toFixed(2))} hint={`${rows.reduce((a, p) => a + p.entityCount, 0)} entidade(s) vinculada(s)`} />
      </div>}
      <div className="row" style={{ marginBottom: 10 }}><Input placeholder="Buscar parceiro" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 260 }} /></div>
      <div className="card">
        {!data ? <div className="bd small muted">Carregando…</div> : data.length === 0 ? <div className="bd"><Empty>Nenhum parceiro cadastrado</Empty></div> : (
          <div className="tbl"><Table>
            <thead><tr><Th>Parceiro</Th><Th>Tipo</Th><Th className="r">Entidades</Th><Th className="r">Valor mensal</Th><Th className="r">Pago no exercício</Th><Th>Situação</Th></tr></thead>
            <tbody>{data.map((p) => (
              <tr key={p.id} className="click" onClick={() => router.push(`/parceiros/${p.id}`)}>
                <Td><span className="link">{p.name}</span>{p.contactName && <div className="small muted">{p.contactName}{p.email ? ` · ${p.email}` : ''}</div>}{p.userName && <div className="small muted">portal: {p.userName}</div>}</Td>
                <Td>{PARTNER_KIND_LABELS[p.kind as PartnerKind] ?? p.kind}</Td>
                <Td className="r num">{p.entityCount}</Td><Td className="r num">{formatBRL(p.monthlyTotal)}</Td><Td className="r num">{formatBRL(p.paidThisYear)}{p.paidThroughThisYear && <div className="small muted">até {p.paidThroughThisYear.slice(5)}/{p.paidThroughThisYear.slice(0, 4)}</div>}</Td>
                <Td><Badge tone={p.isActive ? 'good' : 'neutral'}>{p.isActive ? 'Ativo' : 'Inativo'}</Badge></Td>
              </tr>))}</tbody>
          </Table></div>
        )}
      </div>
      {editing && <PartnerForm partner={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(p) => { setEditing(null); void qc.invalidateQueries({ queryKey: ['partners'] }); if (editing === 'new') router.push(`/parceiros/${p.id}`); }} />}
      {paying && data && <PaymentPicker partners={data} onClose={() => setPaying(false)} onSaved={(r) => { setPaying(false); for (const k of ['partners', 'partner-payments', 'partner-statement']) void qc.invalidateQueries({ queryKey: [k] }); showToast(paymentToast(r)); }} />}
      {toast}
    </div>
  );
}
