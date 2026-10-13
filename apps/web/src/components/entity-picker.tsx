'use client';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { ENTITY_TYPES, ENTITY_TYPE_LABELS, type EntityType } from '@siow/shared';
import { api } from '@/lib/api';
import { Field, Input, Select } from '@/components/ui';

export const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
interface Municipality { ibgeCode: string; name: string; uf: string }
interface EntityLite { id: string; name: string; shortName: string | null; type: EntityType; municipality: string; uf: string }

/** Resultado do seletor: entidade existente (id) ou dados para cadastrá-la ao salvar. */
export type EntityChoice =
  | { kind: 'existing'; id: string; label: string }
  | { kind: 'new'; type: EntityType; name: string; shortName: string; municipality: string; uf: string; ibgeCode: string | null; label: string }
  | null;

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const ABBR: Partial<Record<EntityType, string>> = { PM: 'PM', CM: 'CM' };
/** "Prefeitura", "pref", "Câmara", "cm"… → tipo. */
function parseType(text: string): EntityType | null {
  const t = norm(text);
  if (!t) return null;
  for (const k of ENTITY_TYPES) if (norm(ENTITY_TYPE_LABELS[k]) === t || norm(k) === t) return k;
  if (t.startsWith('pref')) return 'PM';
  if (t.startsWith('cam') || t === 'cm') return 'CM';
  for (const k of ENTITY_TYPES) if (norm(ENTITY_TYPE_LABELS[k]).startsWith(t)) return k;
  return null;
}

/**
 * Seletor de entidade por UF → município (IBGE) → tipo (digitável: Prefeitura/Câmara…).
 * Se a entidade já existir, devolve o id; senão devolve os dados para cadastro automático ao salvar.
 */
export function EntityPicker({ value, onChange }: { value: EntityChoice; onChange: (c: EntityChoice) => void }) {
  const [uf, setUf] = useState('');
  const [municipality, setMunicipality] = useState('');
  const [typeText, setTypeText] = useState('Prefeitura Municipal');
  const { data: munis, isLoading: loadingMunis } = useQuery({ queryKey: ['ibge-munis', uf], queryFn: () => api<Municipality[]>('/integracoes/lookup/ibge/municipios', { query: { uf } }), enabled: uf.length === 2, staleTime: 3_600_000 });
  const { data: existing } = useQuery({ queryKey: ['entities-by-uf', uf], queryFn: () => api<{ items: EntityLite[] }>('/financeiro/entities', { query: { uf, pageSize: 100, page: 1 } }), enabled: uf.length === 2, staleTime: 60_000 });
  const muni = useMemo(() => munis?.find((m) => norm(m.name) === norm(municipality)) ?? null, [munis, municipality]);
  const type = parseType(typeText);
  const match = useMemo(() => existing?.items.find((e) => e.type === type && norm(e.municipality) === norm(municipality)) ?? null, [existing, type, municipality]);

  useEffect(() => {
    if (!uf || !municipality.trim() || !type) { if (value) onChange(null); return; }
    if (match) { const c: EntityChoice = { kind: 'existing', id: match.id, label: match.shortName ?? match.name }; if (!value || value.kind !== 'existing' || value.id !== c.id) onChange(c); return; }
    const name = muni?.name ?? municipality.trim();
    const label = ENTITY_TYPE_LABELS[type];
    const c: EntityChoice = { kind: 'new', type, name: `${label.toUpperCase()} DE ${name.toUpperCase()}`, shortName: `${ABBR[type] ?? label} ${name}`, municipality: name, uf, ibgeCode: muni?.ibgeCode ?? null, label: `${label} de ${name} (${uf})` };
    if (!value || value.kind !== 'new' || value.name !== c.name || value.ibgeCode !== c.ibgeCode) onChange(c);
  }, [uf, municipality, type, match, muni]); // eslint-disable-line

  return (
    <>
      <Field label="UF"><Select value={uf} onChange={(e) => { setUf(e.target.value); setMunicipality(''); }}><option value="">Selecione…</option>{UFS.map((u) => <option key={u} value={u}>{u}</option>)}</Select></Field>
      <Field label={loadingMunis ? 'Município (carregando…)' : 'Município'}>
        <Input list="ep-munis" value={municipality} disabled={!uf} placeholder={uf ? 'Digite para buscar' : 'Escolha a UF'} onChange={(e) => setMunicipality(e.target.value)} />
        <datalist id="ep-munis">{munis?.map((m) => <option key={m.ibgeCode} value={m.name} />)}</datalist>
      </Field>
      <Field label="Tipo de entidade (digite: Prefeitura ou Câmara)">
        <Input list="ep-types" value={typeText} onChange={(e) => setTypeText(e.target.value)} placeholder="Prefeitura Municipal" />
        <datalist id="ep-types">{ENTITY_TYPES.map((t) => <option key={t} value={ENTITY_TYPE_LABELS[t]} />)}</datalist>
      </Field>
      <div className="small" style={{ alignSelf: 'end', paddingBottom: 6, color: value ? (value.kind === 'existing' ? 'var(--good)' : 'var(--info)') : 'var(--ink3)' }}>
        {!uf ? 'Escolha a UF para listar os municípios.' : !municipality.trim() ? `${munis?.length ?? 0} municípios em ${uf}.` : !type ? 'Tipo não reconhecido: digite Prefeitura ou Câmara.' : value?.kind === 'existing' ? `Entidade já cadastrada: ${value.label}` : value?.kind === 'new' ? `Nova entidade será cadastrada: ${value.label}` : ''}
      </div>
    </>
  );
}
