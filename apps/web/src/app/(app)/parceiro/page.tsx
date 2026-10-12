'use client';
import { useQuery } from '@tanstack/react-query';
import { OPPORTUNITY_STATUS_LABELS, formatBRL, type OpportunityStatus, type PartnerStatement } from '@siow/shared';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CommissionsTable } from '@/components/crm/commissions-table';
import { Badge, Empty, Stat, Table, Td, Th } from '@/components/ui';

/** Portal do parceiro: somente os dados do parceiro ligado ao usuário logado (papel PARCEIRO). Somente leitura. */
export default function PartnerPortalPage() {
  const { user } = useAuth();
  const { data, error } = useQuery({ queryKey: ['partner-me'], queryFn: () => api<PartnerStatement>('/parceiros/me'), retry: false });
  if (error) return <div className="alert crit">{error instanceof ApiError ? error.message : 'Não foi possível carregar o portal'}</div>;
  if (!data) return <div className="muted">Carregando…</div>;
  const p = data.partner;
  return (
    <div>
      <h1>Portal do parceiro</h1>
      <p className="sub">{p.name} · {user?.organization?.name}. Comissões calculadas sobre recebimentos confirmados no Financeiro; o pagamento ao parceiro é registrado pela equipe.</p>
      <div className="g4">
        <Stat small label="Previstas" value={formatBRL(data.totals.forecast)} tone="info" hint="notas emitidas ainda não pagas" />
        <Stat small label="A receber" value={formatBRL(data.totals.due)} tone={data.totals.dueCount ? 'warn' : 'good'} hint={`${data.totals.dueCount} comissão(ões)`} />
        <Stat small label="Recebidas" value={formatBRL(data.totals.paid)} tone="good" />
        <Stat small label="Estornadas" value={formatBRL(data.totals.reversed)} />
      </div>
      <div className="g2" style={{ margin: '12px 0' }}>
        <div className="card"><div className="hd"><h2>Meus clientes</h2></div><div className="bd">{data.entities.length === 0 ? <Empty>Nenhuma entidade vinculada</Empty> : <Table><thead><tr><Th>Entidade</Th><Th>Município/UF</Th><Th>Contrato ativo</Th></tr></thead><tbody>{data.entities.map((e) => <tr key={e.id}><Td>{e.shortName ?? e.name}</Td><Td>{e.municipality}/{e.uf}</Td><Td className="num">{e.activeContract ?? '—'}</Td></tr>)}</tbody></Table>}</div></div>
        <div className="card"><div className="hd"><h2>Oportunidades</h2></div><div className="bd">{data.opportunities.length === 0 ? <Empty>Nenhuma oportunidade</Empty> : <Table><thead><tr><Th>Oportunidade</Th><Th>Entidade</Th><Th>Situação</Th></tr></thead><tbody>{data.opportunities.map((o) => <tr key={o.id}><Td>{o.title}</Td><Td>{o.entityName}</Td><Td><Badge tone={o.status === 'WON' ? 'good' : o.status === 'LOST' ? 'critical' : 'info'}>{o.status === 'OPEN' ? o.stageName : OPPORTUNITY_STATUS_LABELS[o.status as OpportunityStatus]}</Badge></Td></tr>)}</tbody></Table>}</div></div>
      </div>
      <h2 style={{ margin: '8px 0' }}>Extrato de comissões</h2>
      <CommissionsTable partnerId={p.id} readOnly endpoint="/parceiros/me" />
    </div>
  );
}
