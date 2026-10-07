'use client';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { ENTITY_TYPES, ENTITY_TYPE_LABELS, MONTH_NAMES_PT, type DashboardFilter } from '@siow/shared';
import { api } from '@/lib/api';

export type Filters = DashboardFilter;

interface Options {
  entities: Array<{ id: string; name: string; shortName: string | null; type: string; municipality: string; uf: string; contracts: Array<{ id: string; number: string }> }>;
  municipalities: string[];
  ufs: string[];
  years: number[];
  users: Array<{ id: string; name: string }>;
}

export function useFilterOptions() {
  return useQuery({ queryKey: ['filter-options'], queryFn: () => api<Options>('/financeiro/dashboard/filter-options'), staleTime: 5 * 60_000 });
}

// ---- estado compartilhado: os filtros globais valem para o Dashboard e para os Relatórios (spec §5.3) ----
const KEY = 'siow.filters';
let current: Filters = {};
let loaded = false;
const listeners = new Set<() => void>();
function load(): Filters {
  if (!loaded && typeof window !== 'undefined') {
    loaded = true;
    try { current = JSON.parse(window.sessionStorage.getItem(KEY) ?? '{}') as Filters; } catch { current = {}; }
  }
  return current;
}
function save(f: Filters): void {
  current = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== '')) as Filters;
  try { window.sessionStorage.setItem(KEY, JSON.stringify(current)); } catch { /* armazenamento indisponível */ }
  listeners.forEach((l) => l());
}
const EMPTY: Filters = {};
export function useGlobalFilters(): [Filters, (f: Filters) => void] {
  const value = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, load, () => EMPTY);
  return [value, useCallback((f: Filters) => save(f), [])];
}

/** Barra de filtros do protótipo: entidade · exercício · situação + "Mais filtros" (tipo, mês, responsável). */
export function GlobalFilters({ value, onChange, showStatus = true }: { value: Filters; onChange: (f: Filters) => void; showStatus?: boolean }) {
  const { data: o } = useFilterOptions();
  const [more, setMore] = useState(Boolean(value.entityType || value.month || value.responsibleUserId));
  const set = (patch: Partial<Filters>): void => onChange({ ...value, ...patch });
  const active = Object.values(value).filter((v) => v !== undefined && v !== '').length;
  const years = o?.years.length ? o.years : [new Date().getFullYear()];
  return (
    <div className="filters">
      <select value={value.entityId ?? ''} onChange={(e) => set({ entityId: e.target.value || undefined, contractId: undefined })} aria-label="Entidade">
        <option value="">Todas as entidades</option>
        {o?.entities.filter((e) => !value.entityType || e.type === value.entityType).map((e) => <option key={e.id} value={e.id}>{e.shortName ?? e.name}</option>)}
      </select>
      <select value={value.year ?? ''} onChange={(e) => set({ year: e.target.value ? Number(e.target.value) : undefined })} aria-label="Exercício">
        <option value="">Todos os exercícios</option>
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      {showStatus && (
        <select value={value.status ?? ''} onChange={(e) => set({ status: (e.target.value || undefined) as Filters['status'] })} aria-label="Situação">
          <option value="">Todas as situações</option>
          <option value="PENDING">Só pendentes</option>
          <option value="PAID">Só pagas</option>
        </select>
      )}
      {more && (
        <>
          <select value={value.entityType ?? ''} onChange={(e) => set({ entityType: (e.target.value || undefined) as Filters['entityType'], entityId: undefined })} aria-label="Tipo">
            <option value="">Todos os tipos</option>
            {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t} — {ENTITY_TYPE_LABELS[t]}</option>)}
          </select>
          <select value={value.month ?? ''} onChange={(e) => set({ month: e.target.value ? Number(e.target.value) : undefined })} aria-label="Mês">
            <option value="">Todos os meses</option>
            {MONTH_NAMES_PT.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select value={value.responsibleUserId ?? ''} onChange={(e) => set({ responsibleUserId: e.target.value || undefined })} aria-label="Responsável">
            <option value="">Todos os responsáveis</option>
            {o?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </>
      )}
      <button className="btn ghost sm" onClick={() => setMore(!more)}>{more ? 'Menos filtros' : 'Mais filtros'}</button>
      {active > 0 && <button className="btn ghost sm" onClick={() => onChange({})}>Limpar ({active})</button>}
    </div>
  );
}
