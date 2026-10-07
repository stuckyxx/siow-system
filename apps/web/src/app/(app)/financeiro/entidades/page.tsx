'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { ENTITY_TYPES, ENTITY_TYPE_LABELS, formatBRL, formatBrDate, formatBrDateTime, type EntitySummary, type Paginated } from '@siow/shared';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CollectionStatusBadge, SyncStatusBadge } from '@/components/status';
import { Button, Card, Dialog, Empty, Field, Input, Pagination, Select, Table, Td, Th, Textarea } from '@/components/ui';

type Sort = { by: string; dir: 'asc' | 'desc' };

export default function EntitiesPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [onlyDebt, setOnlyDebt] = useState(false);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<Sort>({ by: 'debtTotal', dir: 'desc' });
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['entities', q, type, onlyDebt, page, sort],
    queryFn: () => api<Paginated<EntitySummary>>('/financeiro/entities', { query: { q, type, onlyWithDebt: onlyDebt || undefined, page, pageSize: 25, sortBy: sort.by, sortDir: sort.dir } }),
  });
  const syncAll = useMutation({ mutationFn: () => api('/financeiro/sync/all', { method: 'POST' }) });

  const th = (key: string, label: string, right = false) => (
    <Th className={right ? 'text-right' : ''}>
      <button className="hover:text-ink" onClick={() => setSort({ by: key, dir: sort.by === key && sort.dir === 'desc' ? 'asc' : 'desc' })}>
        {label}{sort.by === key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
      </button>
    </Th>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Entidades</h1>
        <div className="flex gap-2">
          {can('integrations.manage') && <Button variant="secondary" onClick={() => syncAll.mutate()} disabled={syncAll.isPending}>{syncAll.isSuccess ? 'Sincronização enfileirada' : 'Sincronizar todas'}</Button>}
          {can('entities.write') && <Button variant="secondary" onClick={() => setImporting(true)}>Importar CSV/XLSX</Button>}
          {can('entities.write') && <Button onClick={() => setCreating(true)}>Nova entidade</Button>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input placeholder="Buscar por município, entidade, contrato ou nº da nota" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="max-w-md" />
        <Select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className="w-40"><option value="">Todos os tipos</option>{ENTITY_TYPES.map((t) => <option key={t} value={t}>{t} — {ENTITY_TYPE_LABELS[t]}</option>)}</Select>
        <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={onlyDebt} onChange={(e) => { setOnlyDebt(e.target.checked); setPage(1); }} /> Somente com débito</label>
      </div>
      <Card>
        {isLoading ? <div className="p-6 text-sm text-ink-3">Carregando…</div> : !data || data.items.length === 0 ? <div className="p-6"><Empty>Nenhuma entidade encontrada</Empty></div> : (
          <Table>
            <thead>
              <tr>
                {th('type', 'Tipo')}{th('name', 'Entidade')}<Th>Contrato ativo</Th>{th('debtTotal', 'Em débito', true)}{th('pendingInvoices', 'Pendentes', true)}{th('lastPaymentAt', 'Último pagamento')}<Th>OS</Th><Th>Cobrança</Th><Th>Situação</Th>{th('lastSyncAt', 'Sincronização')}
              </tr>
            </thead>
            <tbody>
              {data.items.map((e) => (
                <tr key={e.id} className="hover:bg-surface">
                  <Td className="font-medium">{e.type}</Td>
                  <Td><Link href={`/financeiro/entidades/${e.id}`} className="text-brand hover:underline">{e.shortName ?? e.name}</Link><div className="text-xs text-ink-3">{e.municipality}/{e.uf}</div></Td>
                  <Td>{e.activeContractNumber ?? <span className="text-ink-3">—</span>}{e.activeContractEndDate && <div className="text-xs text-ink-3">até {formatBrDate(e.activeContractEndDate)}</div>}</Td>
                  <Td className={`text-right tabular-nums ${Number(e.debtTotal) > 0 ? 'font-medium' : 'text-ink-3'}`}>{formatBRL(e.debtTotal)}</Td>
                  <Td className="text-right tabular-nums">{e.pendingInvoices}</Td>
                  <Td className="tabular-nums">{e.lastPaymentAt ? <>{formatBrDate(e.lastPaymentAt)}<div className="text-xs text-ink-3">{formatBRL(e.lastPaymentAmount)}</div></> : <span className="text-ink-3">Nunca</span>}</Td>
                  <Td>{e.pendingServiceOrders > 0 ? <span className="text-warn">{e.pendingServiceOrders} pendente(s)</span> : <span className="text-ink-3">—</span>}</Td>
                  <Td><CollectionStatusBadge status={e.collectionStatus} />{e.lastCollectionAt && <div className="text-xs text-ink-3">{formatBrDate(e.lastCollectionAt.slice(0, 10))}</div>}</Td>
                  <Td>{e.needsReconciliation > 0 ? <span className="text-critical">{e.needsReconciliation} a verificar</span> : e.pendingInvoices > 0 ? <span className="text-warn">Com pendências</span> : <span className="text-good">Em dia</span>}</Td>
                  <Td><SyncStatusBadge status={e.lastSyncStatus} />{e.lastSyncAt && <div className="text-xs text-ink-3">{formatBrDateTime(e.lastSyncAt)}</div>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {data && <div className="px-3"><Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} /></div>}
      </Card>

      <EntityForm open={creating} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); qc.invalidateQueries({ queryKey: ['entities'] }); }} />
      <ImportDialog open={importing} onClose={() => setImporting(false)} onDone={() => qc.invalidateQueries({ queryKey: ['entities'] })} />
    </div>
  );
}

function EntityForm({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ type: 'CM', name: '', shortName: '', municipality: '', uf: 'MA', url: '', notes: '' });
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: async () => {
      const entity = await api<{ id: string }>('/financeiro/entities', { method: 'POST', body: { type: form.type, name: form.name, shortName: form.shortName || null, municipality: form.municipality, uf: form.uf, notes: form.notes || null } });
      if (form.url) await api(`/financeiro/entities/${entity.id}/data-sources`, { method: 'POST', body: { provider: 'ASSESI_PORTAL', url: form.url, label: 'Portal do Cliente' } });
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? `${e.message}${e.issues ? ': ' + e.issues.map((i) => `${i.path} ${i.message}`).join('; ') : ''}` : 'Erro'),
  });
  const f = (k: keyof typeof form) => ({ value: form[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value }) });
  return (
    <Dialog open={open} onClose={onClose} title="Nova entidade">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Tipo"><Select {...f('type')}>{ENTITY_TYPES.map((t) => <option key={t} value={t}>{t} — {ENTITY_TYPE_LABELS[t]}</option>)}</Select></Field>
        <Field label="UF"><Input maxLength={2} {...f('uf')} /></Field>
        <Field label="Município"><Input {...f('municipality')} placeholder="Bom Lugar" /></Field>
        <Field label="Nome curto"><Input {...f('shortName')} placeholder="CM BOM LUGAR" /></Field>
        <Field label="Nome completo" className="md:col-span-2"><Input {...f('name')} placeholder="CÂMARA MUNICIPAL DE BOM LUGAR" /></Field>
        <Field label="URL financeira (Portal do Cliente)" className="md:col-span-2"><Input {...f('url')} placeholder="https://…/adm_faturas/index.php?e=…&t=1" /></Field>
        <Field label="Observações" className="md:col-span-2"><Textarea rows={2} {...f('notes')} /></Field>
      </div>
      {error && <p className="mt-2 text-sm text-critical">{error}</p>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => create.mutate()} disabled={create.isPending}>Salvar</Button></div>
    </Dialog>
  );
}

function ImportDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ created: number; reused: number; sourcesCreated: number; errors: Array<{ line: number; error: string }> } | null>(null);
  const upload = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append('file', file!);
      return api<NonNullable<typeof result>>('/financeiro/entities/import', { method: 'POST', formData: fd });
    },
    onSuccess: (r) => { setResult(r); onDone(); },
  });
  return (
    <Dialog open={open} onClose={onClose} title="Importar entidades em lote">
      <p className="text-sm text-ink-2">Arquivo CSV (separado por ; ou ,) ou XLSX com as colunas: <code>tipo, entidade, municipio, uf, url, nome_completo</code>. Ex.: <code>CM;Araioses;Araioses;MA;https://…;CÂMARA MUNICIPAL DE ARAIOSES</code></p>
      <Input type="file" accept=".csv,.xlsx" className="mt-3" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      {result && (
        <div className="mt-3 rounded-md bg-surface p-3 text-sm">
          <div>Criadas: {result.created} · Reaproveitadas: {result.reused} · Fontes cadastradas: {result.sourcesCreated}</div>
          {result.errors.length > 0 && <ul className="mt-2 list-disc pl-5 text-critical">{result.errors.map((e) => <li key={e.line}>Linha {e.line}: {e.error}</li>)}</ul>}
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Fechar</Button><Button onClick={() => upload.mutate()} disabled={!file || upload.isPending}>Importar</Button></div>
    </Dialog>
  );
}
