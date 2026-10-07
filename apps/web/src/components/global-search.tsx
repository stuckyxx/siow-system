'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { formatBRL, type EntitySummary, type InvoiceRow, type Paginated } from '@siow/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface Hit { kind: string; label: string; detail: string; href: string }

/** Busca global do topo: entidade, município, nº de nota ou nº de contrato. */
export function GlobalSearch() {
  const router = useRouter();
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<Hit[] | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits(null); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      const out: Hit[] = [];
      const [ents, invs, cons] = await Promise.all([
        can('entities.read') ? api<Paginated<EntitySummary>>('/financeiro/entities', { query: { q: term, pageSize: 5 } }).catch(() => null) : null,
        can('invoices.read') && /\d{3,}/.test(term) ? api<Paginated<InvoiceRow>>('/financeiro/invoices', { query: { q: term, pageSize: 5 } }).catch(() => null) : null,
        can('contracts.read') ? api<Array<{ id: string; number: string; origin: string; entity?: { id: string; shortName: string | null; name: string } }>>('/financeiro/contracts', { query: { q: term } }).catch(() => null) : null,
      ]);
      ents?.items.forEach((e) => out.push({ kind: 'Entidade', label: e.shortName ?? e.name, detail: `${e.municipality}/${e.uf}`, href: `/financeiro/entidades/${e.id}` }));
      cons?.filter((c) => c.number.toLowerCase().includes(term.toLowerCase())).slice(0, 3).forEach((c) => out.push({ kind: 'Contrato', label: c.number, detail: c.entity?.shortName ?? c.entity?.name ?? '', href: `/financeiro/entidades/${c.entity?.id ?? ''}?tab=${c.origin === 'MANUAL' ? 'contracts' : 'invoices'}` }));
      invs?.items.forEach((i) => out.push({ kind: 'Nota', label: `${i.number} · ${String(i.competenceMonth).padStart(2, '0')}/${i.competenceYear}`, detail: `${i.entityName} · ${formatBRL(i.amount)}`, href: `/financeiro/entidades/${i.entityId}?tab=invoices&nota=${i.id}` }));
      if (!cancelled) setHits(out);
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, can]);

  const goTo = (href: string): void => { setOpen(false); setQ(''); router.push(href); };

  return (
    <div className="search">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
      <input placeholder="Buscar entidade, município, nota ou contrato…" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 180)} aria-label="Busca global" />
      {open && hits && (
        <div className="sugg">
          {hits.length === 0 ? <button disabled className="muted">Nada encontrado</button> : hits.map((h, i) => (
            <button key={i} onMouseDown={() => goTo(h.href)}><span className="k">{h.kind}</span>{h.label} <span className="muted small">{h.detail}</span></button>
          ))}
        </div>
      )}
    </div>
  );
}
