'use client';
import { useQuery } from '@tanstack/react-query';
import { ENTITY_TYPES, ENTITY_TYPE_LABELS, INVOICE_STATUS_LABELS, MONTH_NAMES_PT, type DashboardFilter } from '@siow/shared';
import { api } from '@/lib/api';
import { Button, Input, Select } from './ui';

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

/** Filtros globais (spec §8) — atualizam cards, gráficos e tabelas. */
export function GlobalFilters({ value, onChange, showStatus = true }: { value: Filters; onChange: (f: Filters) => void; showStatus?: boolean }) {
  const { data: o } = useFilterOptions();
  const set = (patch: Partial<Filters>): void => onChange({ ...value, ...patch });
  const entity = o?.entities.find((e) => e.id === value.entityId);
  const active = Object.values(value).filter((v) => v !== undefined && v !== '').length;
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-card p-3">
      <Select value={value.entityType ?? ''} onChange={(e) => set({ entityType: (e.target.value || undefined) as Filters['entityType'] })} className="w-36" aria-label="Tipo">
        <option value="">Tipo (PM/CM)</option>
        {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t} — {ENTITY_TYPE_LABELS[t]}</option>)}
      </Select>
      <Select value={value.uf ?? ''} onChange={(e) => set({ uf: e.target.value || undefined })} className="w-24" aria-label="UF">
        <option value="">UF</option>
        {o?.ufs.map((u) => <option key={u} value={u}>{u}</option>)}
      </Select>
      <Select value={value.municipality ?? ''} onChange={(e) => set({ municipality: e.target.value || undefined })} className="w-44" aria-label="Município">
        <option value="">Município</option>
        {o?.municipalities.map((m) => <option key={m} value={m}>{m}</option>)}
      </Select>
      <Select value={value.entityId ?? ''} onChange={(e) => set({ entityId: e.target.value || undefined, contractId: undefined })} className="w-56" aria-label="Entidade">
        <option value="">Entidade</option>
        {o?.entities.filter((e) => (!value.entityType || e.type === value.entityType) && (!value.uf || e.uf === value.uf)).map((e) => <option key={e.id} value={e.id}>{e.shortName ?? e.name}</option>)}
      </Select>
      {entity && entity.contracts.length > 0 && (
        <Select value={value.contractId ?? ''} onChange={(e) => set({ contractId: e.target.value || undefined })} className="w-44" aria-label="Contrato">
          <option value="">Contrato</option>
          {entity.contracts.map((c) => <option key={c.id} value={c.id}>{c.number}</option>)}
        </Select>
      )}
      <Select value={value.year ?? ''} onChange={(e) => set({ year: e.target.value ? Number(e.target.value) : undefined })} className="w-28" aria-label="Exercício">
        <option value="">Exercício</option>
        {o?.years.map((y) => <option key={y} value={y}>{y}</option>)}
      </Select>
      <Select value={value.month ?? ''} onChange={(e) => set({ month: e.target.value ? Number(e.target.value) : undefined })} className="w-32" aria-label="Mês">
        <option value="">Mês</option>
        {MONTH_NAMES_PT.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
      </Select>
      <Input type="month" value={value.competenceFrom ?? ''} onChange={(e) => set({ competenceFrom: e.target.value || undefined })} className="w-36" aria-label="Competência de" />
      <Input type="month" value={value.competenceTo ?? ''} onChange={(e) => set({ competenceTo: e.target.value || undefined })} className="w-36" aria-label="Competência até" />
      {showStatus && (
        <Select value={value.status ?? ''} onChange={(e) => set({ status: (e.target.value || undefined) as Filters['status'] })} className="w-36" aria-label="Situação">
          <option value="">Todas as notas</option>
          <option value="PENDING">{INVOICE_STATUS_LABELS.PENDING}s</option>
          <option value="PAID">{INVOICE_STATUS_LABELS.PAID}s</option>
          <option value="CANCELLED">{INVOICE_STATUS_LABELS.CANCELLED}s</option>
        </Select>
      )}
      <Select value={value.responsibleUserId ?? ''} onChange={(e) => set({ responsibleUserId: e.target.value || undefined })} className="w-40" aria-label="Responsável">
        <option value="">Responsável</option>
        {o?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </Select>
      <Button variant="ghost" size="sm" onClick={() => onChange({})} disabled={active === 0}>Limpar filtros{active > 0 ? ` (${active})` : ''}</Button>
    </div>
  );
}
