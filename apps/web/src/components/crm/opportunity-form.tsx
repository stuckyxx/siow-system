'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { OPPORTUNITY_SOURCES, OPPORTUNITY_SOURCE_LABELS, RECURRENCES, RECURRENCE_LABELS, formatBRL, type CatalogItemRow, type OpportunityRow, type PipelineRow } from '@siow/shared';
import { api, ApiError } from '@/lib/api';
import { useAssignees } from '@/components/panels/tasks-panel';
import { Button, Dialog, Field, Input, Select, Textarea } from '@/components/ui';
import { EntityPicker, type EntityChoice } from '@/components/entity-picker';

export interface ItemDraft { catalogItemId: string | null; description: string; quantity: string; unitPrice: string; recurrence: string }
export const errMsg = (e: unknown): string => (e instanceof ApiError ? `${e.message}${e.issues?.length ? ': ' + e.issues.map((i) => `${i.path} ${i.message}`).join('; ') : ''}` : 'Erro inesperado');
export const money = (v: string): number => Number(String(v).replace(/\./g, '').replace(',', '.')) || 0;

/** Editor de itens (produtos/serviços) compartilhado por oportunidade e proposta. */
export function ItemsEditor({ items, onChange, catalog }: { items: ItemDraft[]; onChange: (items: ItemDraft[]) => void; catalog?: CatalogItemRow[] }) {
  const set = (i: number, patch: Partial<ItemDraft>): void => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const pick = (i: number, id: string): void => {
    const c = catalog?.find((x) => x.id === id);
    set(i, c ? { catalogItemId: c.id, description: c.name, unitPrice: c.unitPrice.replace('.', ','), recurrence: c.recurrence } : { catalogItemId: null });
  };
  const totals = items.reduce((acc, it) => { const t = money(it.unitPrice) * (Number(String(it.quantity).replace(',', '.')) || 0); if (it.recurrence === 'MONTHLY') acc.monthly += t; else if (it.recurrence === 'YEARLY') acc.monthly += t / 12; else acc.oneTime += t; return acc; }, { monthly: 0, oneTime: 0 });
  return (
    <div className="md:col-span-2">
      <div className="row between"><b className="small">Itens (produtos / serviços)</b><Button size="sm" variant="secondary" onClick={() => onChange([...items, { catalogItemId: null, description: '', quantity: '1', unitPrice: '', recurrence: 'MONTHLY' }])}>+ Item</Button></div>
      {items.length === 0 && <p className="small muted" style={{ margin: '6px 0' }}>Sem itens: informe os valores diretamente abaixo. Com itens, os valores da oportunidade passam a ser a soma deles.</p>}
      {items.map((it, i) => (
        <div key={i} className="grid gap-2" style={{ gridTemplateColumns: catalog?.length ? '1.2fr 2fr .6fr .9fr .9fr auto' : '2.4fr .6fr .9fr .9fr auto', marginTop: 6, alignItems: 'end' }}>
          {catalog?.length ? <Select value={it.catalogItemId ?? ''} onChange={(e) => pick(i, e.target.value)}><option value="">Item livre</option>{catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select> : null}
          <Input value={it.description} placeholder="Descrição" onChange={(e) => set(i, { description: e.target.value })} />
          <Input value={it.quantity} placeholder="Qtd" onChange={(e) => set(i, { quantity: e.target.value })} />
          <Input value={it.unitPrice} placeholder="Valor unit. (R$)" onChange={(e) => set(i, { unitPrice: e.target.value })} />
          <Select value={it.recurrence} onChange={(e) => set(i, { recurrence: e.target.value })}>{RECURRENCES.map((r) => <option key={r} value={r}>{RECURRENCE_LABELS[r]}</option>)}</Select>
          <Button size="sm" variant="ghost" onClick={() => onChange(items.filter((_, j) => j !== i))}>✕</Button>
        </div>
      ))}
      {items.length > 0 && <div className="small muted" style={{ marginTop: 6 }}>Mensal {formatBRL(totals.monthly.toFixed(2))} · Único {formatBRL(totals.oneTime.toFixed(2))}</div>}
    </div>
  );
}

export function useCatalog(): CatalogItemRow[] | undefined {
  return useQuery({ queryKey: ['catalog-active'], queryFn: () => api<CatalogItemRow[]>('/comercial/catalog', { query: { active: true } }), staleTime: 60_000 }).data;
}
export function usePipelines(): PipelineRow[] | undefined {
  return useQuery({ queryKey: ['pipelines'], queryFn: () => api<PipelineRow[]>('/comercial/pipelines'), staleTime: 60_000 }).data;
}

/** Nova oportunidade / edição. Sem `entityId`, mostra o seletor de entidade (todas as cadastradas). */
export function OpportunityForm({ open, opportunity, entityId, onClose, onSaved }: { open: boolean; opportunity?: (OpportunityRow & { items?: Array<{ catalogItemId: string | null; description: string; quantity: string; unitPrice: string; recurrence: string }> }) | null; entityId?: string; onClose: () => void; onSaved: (o: OpportunityRow) => void }) {
  const editing = Boolean(opportunity);
  const { data: assignees } = useAssignees();
  const catalog = useCatalog();
  const pipelines = usePipelines();
  const { data: entities } = useQuery({ queryKey: ['entities-lite'], queryFn: () => api<{ entities: Array<{ id: string; name: string; shortName: string | null }> }>('/financeiro/dashboard/filter-options'), enabled: !entityId && !editing });
  const init = {
    entityId: opportunity?.entity.id ?? entityId ?? '', title: opportunity?.title ?? '', description: opportunity?.description ?? '', monthlyAmount: opportunity?.monthlyAmount?.replace('.', ',') ?? '', oneTimeAmount: opportunity?.oneTimeAmount?.replace('.', ',') ?? '',
    termMonths: opportunity?.termMonths ? String(opportunity.termMonths) : '12', probability: opportunity?.probability !== null && opportunity?.probability !== undefined ? String(opportunity.probability) : '', expectedCloseDate: opportunity?.expectedCloseDate ?? '', source: opportunity?.source ?? 'PROSPECCAO', ownerUserId: opportunity?.owner?.id ?? '', stageId: opportunity?.stage.id ?? '',
  };
  const [f, setF] = useState(init);
  const [items, setItems] = useState<ItemDraft[]>(opportunity?.items?.map((i) => ({ catalogItemId: i.catalogItemId, description: i.description, quantity: i.quantity.replace('.', ','), unitPrice: i.unitPrice.replace('.', ','), recurrence: i.recurrence })) ?? []);
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<EntityChoice>(null);
  const [mode, setMode] = useState<'picker' | 'list'>('picker');
  if (open && key !== (opportunity?.id ?? 'new')) { setKey(opportunity?.id ?? 'new'); setF(init); setItems(opportunity?.items?.map((i) => ({ catalogItemId: i.catalogItemId, description: i.description, quantity: i.quantity.replace('.', ','), unitPrice: i.unitPrice.replace('.', ','), recurrence: i.recurrence })) ?? []); setError(null); }
  const b = (k: keyof typeof f) => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }) });
  const stages = pipelines?.[0]?.stages.filter((s) => s.kind === 'OPEN') ?? [];
  const m = useMutation({
    mutationFn: async () => {
      // Sem entidade escolhida na lista: resolve pelo seletor UF → município → tipo (cadastra a entidade se ainda não existir).
      let resolvedEntityId = f.entityId;
      if (!editing && !entityId && mode === 'picker') {
        if (!choice) throw new Error('Informe UF, município e tipo da entidade');
        if (choice.kind === 'existing') resolvedEntityId = choice.id;
        else {
          const created = await api<{ id: string }>('/financeiro/entities', { method: 'POST', body: { type: choice.type, name: choice.name, shortName: choice.shortName, municipality: choice.municipality, uf: choice.uf, ibgeCode: choice.ibgeCode } });
          resolvedEntityId = created.id;
        }
      }
      const body = {
        entityId: resolvedEntityId, title: f.title, description: f.description || null, monthlyAmount: items.length ? undefined : f.monthlyAmount || null, oneTimeAmount: items.length ? undefined : f.oneTimeAmount || null,
        termMonths: f.termMonths ? Number(f.termMonths) : null, probability: f.probability === '' ? null : Number(f.probability), expectedCloseDate: f.expectedCloseDate || null, source: f.source || null, ownerUserId: f.ownerUserId || null,
        stageId: !editing && f.stageId ? f.stageId : undefined, items: items.length ? items.map((it) => ({ catalogItemId: it.catalogItemId, description: it.description, quantity: it.quantity, unitPrice: it.unitPrice, recurrence: it.recurrence })) : editing ? [] : undefined,
      };
      return editing ? api<OpportunityRow>(`/comercial/opportunities/${opportunity!.id}`, { method: 'PATCH', body: { ...body, entityId: undefined, stageId: undefined } }) : api<OpportunityRow>('/comercial/opportunities', { method: 'POST', body });
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof Error && !(e instanceof ApiError) ? e.message : errMsg(e)),
  });
  return (
    <Dialog open={open} onClose={onClose} title={editing ? 'Editar oportunidade' : 'Nova oportunidade'} wide>
      <div className="grid gap-3 md:grid-cols-2">
        {!entityId && !editing && (
          <div className="md:col-span-2 grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2 flex items-center justify-between"><b>Entidade</b><button type="button" className="link small" onClick={() => setMode(mode === 'picker' ? 'list' : 'picker')}>{mode === 'picker' ? 'Escolher entre as já cadastradas' : 'Escolher por UF e município'}</button></div>
            {mode === 'picker' ? <EntityPicker value={choice} onChange={setChoice} /> : <Field label="Entidade cadastrada" className="md:col-span-2"><Select {...b('entityId')}><option value="">Selecione…</option>{entities?.entities.map((e) => <option key={e.id} value={e.id}>{e.shortName ?? e.name}</option>)}</Select></Field>}
          </div>
        )}
        <Field label="Título" className="md:col-span-2"><Input {...b('title')} placeholder="Ex.: Portal da transparência + sistema de compras" /></Field>
        {!editing && stages.length > 0 && <Field label="Etapa inicial"><Select {...b('stageId')}><option value="">{stages[0]?.name} (padrão)</option>{stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>}
        <Field label="Origem"><Select {...b('source')}>{OPPORTUNITY_SOURCES.map((s) => <option key={s} value={s}>{OPPORTUNITY_SOURCE_LABELS[s]}</option>)}</Select></Field>
        <Field label="Responsável comercial"><Select {...b('ownerUserId')}><option value="">Eu</option>{assignees?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
        <Field label="Previsão de fechamento"><Input type="date" {...b('expectedCloseDate')} /></Field>
        <ItemsEditor items={items} onChange={setItems} catalog={catalog} />
        {items.length === 0 && <Field label="Valor mensal (R$)"><Input {...b('monthlyAmount')} placeholder="2.500,00" /></Field>}
        {items.length === 0 && <Field label="Valor único (R$)"><Input {...b('oneTimeAmount')} placeholder="0,00" /></Field>}
        <Field label="Prazo (meses)"><Input type="number" min={1} max={120} {...b('termMonths')} /></Field>
        <Field label="Probabilidade (%) — em branco usa a da etapa"><Input type="number" min={0} max={100} {...b('probability')} /></Field>
        <Field label="Descrição / necessidade do cliente" className="md:col-span-2"><Textarea rows={3} {...b('description')} /></Field>
      </div>
      {error && <div className="alert crit" style={{ marginTop: 10 }}>{error}</div>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => m.mutate()} disabled={m.isPending || !f.title || (!editing && !entityId && mode === 'picker' ? !choice : !f.entityId)}>{m.isPending ? 'Salvando…' : 'Salvar'}</Button></div>
    </Dialog>
  );
}
