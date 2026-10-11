'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { formatBrDate, type IssuanceDeadline, type IssuanceDeadlineStatus } from '@siow/shared';
import { api } from '@/lib/api';
import { DEADLINE_LABEL, DEADLINE_TONE, deadlineText } from '@/components/panels/alarms-panel';
import { Badge, Card, Empty, Select, Stat, Table, Td, Th } from '@/components/ui';

/** Painel de prazos de emissão de notas: alarmes atrasados, a vencer (dentro da antecedência), próximos e emitidos no mês. */
export default function AlarmsDashboardPage() {
  const [days, setDays] = useState('30');
  const [status, setStatus] = useState<'' | IssuanceDeadlineStatus>('');
  const { data, isLoading } = useQuery({ queryKey: ['alarm-deadlines', 'all', days], queryFn: () => api<IssuanceDeadline[]>('/financeiro/alarms/deadlines', { query: { days } }) });
  const all = data ?? [];
  const count = (s: IssuanceDeadlineStatus): number => all.filter((d) => d.status === s).length;
  const list = status ? all.filter((d) => d.status === status) : all;

  return (
    <div>
      <div className="row between">
        <div>
          <h1>Prazos de emissão</h1>
          <p className="sub">Alarmes cadastrados na aba "Alarme" de cada entidade · o aviso chega com a antecedência configurada (padrão 5 dias)</p>
        </div>
        <div className="row">
          <Select value={days} onChange={(e) => setDays(e.target.value)} aria-label="Horizonte"><option value="7">Próximos 7 dias</option><option value="15">Próximos 15 dias</option><option value="30">Próximos 30 dias</option><option value="60">Próximos 60 dias</option></Select>
        </div>
      </div>

      <div className="g4" style={{ marginTop: 12 }}>
        <Stat label="Atrasadas" value={count('LATE')} tone={count('LATE') ? 'critical' : 'good'} hint="dia passou sem nota" onClick={() => setStatus(status === 'LATE' ? '' : 'LATE')} />
        <Stat label="A vencer" value={count('DUE')} tone={count('DUE') ? 'warn' : 'good'} hint="dentro da antecedência" onClick={() => setStatus(status === 'DUE' ? '' : 'DUE')} />
        <Stat label="Próximas" value={count('UPCOMING')} tone="info" hint={`nos próximos ${days} dias`} onClick={() => setStatus(status === 'UPCOMING' ? '' : 'UPCOMING')} />
        <Stat label="Emitidas no mês" value={count('ISSUED')} tone="good" hint="nota já saiu" onClick={() => setStatus(status === 'ISSUED' ? '' : 'ISSUED')} />
      </div>

      <Card>
        <div className="hd"><h2>{status ? DEADLINE_LABEL[status] : 'Todos os prazos'}</h2>{status && <button className="btn sm ghost" onClick={() => setStatus('')}>limpar filtro</button>}</div>
        {isLoading ? <div className="p-6 text-sm text-ink-3">Carregando…</div> : list.length === 0 ? <div className="p-6"><Empty>{all.length === 0 ? 'Nenhum alarme cadastrado. Abra uma entidade → aba Alarme → "+ Novo alarme".' : 'Nenhum prazo nesta situação'}</Empty></div> : (
          <Table>
            <thead><tr><Th>Prazo</Th><Th>Entidade</Th><Th>Alarme</Th><Th className="hide-m">Contrato</Th><Th className="hide-m">Competência</Th><Th>Situação</Th><Th></Th></tr></thead>
            <tbody>
              {list.map((d) => (
                <tr key={`${d.id}-${d.competence}`} className="hover:bg-surface">
                  <Td className="tabular-nums font-medium">{formatBrDate(d.dueDate)}</Td>
                  <Td><Link href={`/financeiro/entidades/${d.entityId}?tab=alarms`} className="hover:underline">{d.entityShortName ?? d.entityName}</Link></Td>
                  <Td>{d.label}</Td>
                  <Td className="hide-m text-ink-2">{d.contractNumber ?? '—'}</Td>
                  <Td className="hide-m tabular-nums">{d.competence.split('-').reverse().join('/')}</Td>
                  <Td><Badge tone={DEADLINE_TONE[d.status]}>{DEADLINE_LABEL[d.status]}</Badge> <span className="small muted">{deadlineText(d)}</span></Td>
                  <Td><Link className="btn sm ghost" href={`/financeiro/entidades/${d.entityId}?tab=invoices`}>Notas</Link></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
