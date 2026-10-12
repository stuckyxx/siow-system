'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { todayIso } from '@siow/shared';
import { api } from '@/lib/api';
import { Button } from '@/components/ui';

interface CalTask { id: string; title: string; status: string; dueTime: string | null; entity: { id: string; shortName: string | null; name: string } | null; opportunity: { id: string; title: string } | null }

/** Calendário mensal das atividades comerciais (agenda única filtrada por módulo COMERCIAL). */
export function CrmCalendar({ ownerUserId }: { ownerUserId?: string }) {
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const [y, m] = month.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1)); const last = new Date(Date.UTC(y, m, 0));
  const from = first.toISOString().slice(0, 10); const to = last.toISOString().slice(0, 10);
  const { data } = useQuery({ queryKey: ['crm-calendar', month, ownerUserId], queryFn: () => api<Record<string, CalTask[]>>('/financeiro/tasks/calendar', { query: { from, to, module: 'COMERCIAL', assigneeUserId: ownerUserId } }) });
  const today = todayIso();
  const startPad = first.getUTCDay();
  const cells: Array<string | null> = [...Array<null>(startPad).fill(null), ...Array.from({ length: last.getUTCDate() }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  const shift = (d: number): void => { const n = new Date(Date.UTC(y, m - 1 + d, 1)); setMonth(n.toISOString().slice(0, 7)); };
  return (
    <div>
      <div className="row between" style={{ marginBottom: 8 }}>
        <div className="row"><Button size="sm" variant="secondary" onClick={() => shift(-1)}>‹</Button><b style={{ minWidth: 140, textAlign: 'center' }}>{first.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</b><Button size="sm" variant="secondary" onClick={() => shift(1)}>›</Button></div>
        <span className="small muted">Atividades comerciais (visitas, ligações, reuniões, retornos). Crie-as na oportunidade.</span>
      </div>
      <div className="cal">
        {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d) => <div key={d} className="small muted" style={{ textAlign: 'center' }}>{d}</div>)}
        {cells.map((d, i) => d === null ? <div key={`p${i}`} /> : (
          <div key={d} className={`cd ${d === today ? 'today' : ''}`}>
            <div className="dn">{Number(d.slice(8))}</div>
            {(data?.[d] ?? []).map((t) => (
              <Link key={t.id} href={t.opportunity ? `/comercial/oportunidades/${t.opportunity.id}?tab=activities` : t.entity ? `/financeiro/entidades/${t.entity.id}?tab=agenda` : '/financeiro/agenda'} className={`ev ${t.status === 'DONE' ? 'done' : d < today && t.status !== 'CANCELLED' ? 'late' : ''}`} title={`${t.title}${t.entity ? ` · ${t.entity.shortName ?? t.entity.name}` : ''}`}>
                {t.dueTime ? `${t.dueTime} ` : ''}{t.title}
              </Link>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
