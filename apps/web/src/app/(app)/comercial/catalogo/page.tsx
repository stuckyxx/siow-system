'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { RECURRENCES, RECURRENCE_LABELS, formatBRL, type CatalogItemRow, type Recurrence } from '@siow/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Dialog, Empty, Field, Input, Select, Table, Td, Textarea, Th, useToast } from '@/components/ui';
import { errMsg } from '@/components/crm/opportunity-form';

export default function CatalogPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [toast, showToast] = useToast();
  const [editing, setEditing] = useState<CatalogItemRow | 'new' | null>(null);
  const { data } = useQuery({ queryKey: ['catalog'], queryFn: () => api<CatalogItemRow[]>('/comercial/catalog') });
  const remove = useMutation({ mutationFn: (id: string) => api(`/comercial/catalog/${id}`, { method: 'DELETE' }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['catalog'] }); void qc.invalidateQueries({ queryKey: ['catalog-active'] }); }, onError: (e) => showToast(errMsg(e)) });
  return (
    <div>
      <Link href="/comercial" className="btn sm" style={{ marginBottom: 10 }}>← Comercial</Link>
      <div className="row between"><div><h1>Catálogo de produtos e serviços</h1><p className="sub">Itens reutilizados em oportunidades e propostas, com preço de referência.</p></div>{can('crm.manage') && <Button onClick={() => setEditing('new')}>+ Novo item</Button>}</div>
      <div className="card">
        {!data ? <div className="bd small muted">Carregando…</div> : data.length === 0 ? <div className="bd"><Empty>Catálogo vazio</Empty></div> : (
          <div className="tbl"><Table><thead><tr><Th>Item</Th><Th>Categoria</Th><Th className="r">Preço</Th><Th>Recorrência</Th><Th>Situação</Th><Th /></tr></thead><tbody>
            {data.map((c) => <tr key={c.id}><Td><b>{c.name}</b>{c.code && <span className="muted small"> · {c.code}</span>}{c.description && <div className="small muted">{c.description}</div>}</Td><Td>{c.category ?? '—'}</Td><Td className="r num">{formatBRL(c.unitPrice)}</Td><Td>{RECURRENCE_LABELS[c.recurrence as Recurrence]}</Td><Td><Badge tone={c.isActive ? 'good' : 'neutral'}>{c.isActive ? 'Ativo' : 'Inativo'}</Badge></Td><Td className="r">{can('crm.manage') && <><Button size="sm" variant="ghost" onClick={() => setEditing(c)}>Editar</Button><Button size="sm" variant="ghost" onClick={() => { if (confirm('Remover do catálogo?')) remove.mutate(c.id); }}>Remover</Button></>}</Td></tr>)}
          </tbody></Table></div>
        )}
      </div>
      {editing && <CatalogForm item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void qc.invalidateQueries({ queryKey: ['catalog'] }); void qc.invalidateQueries({ queryKey: ['catalog-active'] }); }} />}
      {toast}
    </div>
  );
}

function CatalogForm({ item, onClose, onSaved }: { item: CatalogItemRow | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ code: item?.code ?? '', name: item?.name ?? '', description: item?.description ?? '', category: item?.category ?? '', unitPrice: item?.unitPrice.replace('.', ',') ?? '', recurrence: item?.recurrence ?? 'MONTHLY', isActive: item?.isActive ?? true });
  const [error, setError] = useState<string | null>(null);
  const b = (k: keyof typeof f) => ({ value: String(f[k]), onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }) });
  const m = useMutation({ mutationFn: () => { const body = { ...f, code: f.code || null, description: f.description || null, category: f.category || null }; return item ? api(`/comercial/catalog/${item.id}`, { method: 'PATCH', body }) : api('/comercial/catalog', { method: 'POST', body }); }, onSuccess: onSaved, onError: (e) => setError(errMsg(e)) });
  return (
    <Dialog open onClose={onClose} title={item ? 'Editar item' : 'Novo item do catálogo'}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Nome" className="md:col-span-2"><Input {...b('name')} placeholder="Ex.: Portal da Transparência" /></Field>
        <Field label="Código"><Input {...b('code')} /></Field>
        <Field label="Categoria"><Input {...b('category')} placeholder="Software, Consultoria, Implantação…" /></Field>
        <Field label="Preço de referência (R$)"><Input {...b('unitPrice')} placeholder="1.500,00" /></Field>
        <Field label="Recorrência"><Select {...b('recurrence')}>{RECURRENCES.map((r) => <option key={r} value={r}>{RECURRENCE_LABELS[r]}</option>)}</Select></Field>
        <Field label="Descrição" className="md:col-span-2"><Textarea rows={2} {...b('description')} /></Field>
        <label className="row small md:col-span-2" style={{ gap: 6 }}><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Ativo (disponível para seleção)</label>
      </div>
      {error && <div className="alert crit" style={{ marginTop: 10 }}>{error}</div>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => m.mutate()} disabled={m.isPending || !f.name || !f.unitPrice}>Salvar</Button></div>
    </Dialog>
  );
}
