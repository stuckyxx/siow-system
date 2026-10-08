'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ENTITY_TYPES, ENTITY_TYPE_LABELS, formatBRL, type EntitySummary, type Paginated } from '@siow/shared';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Dialog, Empty, Field, Input, Select, Textarea, useToast } from '@/components/ui';

const ICON = {
  inv: 'M6 2h9l5 5v15H6zM14 2v6h6M9 13h6M9 17h6',
  con: 'M4 4h16v16H4zM8 9h8M8 13h8M8 17h5',
  age: 'M3 5h18v16H3zM3 9h18M8 3v4M16 3v4',
  os: 'M9 3h6v4H9zM5 5h4M15 5h4v16H5V5M8 12h8M8 16h5',
  sync: 'M21 12a9 9 0 0 1-15.5 6.2M3 12a9 9 0 0 1 15.5-6.2M21 4v5h-5M3 20v-5h5',
};
function Ico({ d }: { d: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
}

/** Entidade "encerrada" = já sincronizada e sem nenhum contrato ativo (ou inativada). Nunca sincronizada continua na lista principal. */
const isEnded = (e: EntitySummary): boolean => !e.isActive || (!e.activeContractNumber && e.lastSyncAt !== null);

function situation(e: EntitySummary): React.ReactNode {
  if (isEnded(e)) return <span className="pill n">Contrato encerrado</span>;
  if (e.needsReconciliation > 0) return <span className="pill crit">{e.needsReconciliation} a verificar</span>;
  if (e.pendingInvoices > 0) return <span className="pill warn">Com pendências · {formatBRL(e.debtTotal)}</span>;
  if (!e.lastSyncAt) return <span className="pill n">Aguardando sincronização</span>;
  return <span className="pill good">Em dia</span>;
}

export default function EntitiesPage() {
  return <Suspense fallback={<div className="muted">Carregando…</div>}><EntitiesList /></Suspense>;
}

function EntitiesList() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const search = useSearchParams();
  const [q, setQ] = useState('');
  const [type, setType] = useState(search.get('type') ?? '');
  const [onlyDebt, setOnlyDebt] = useState(false);
  const [showEnded, setShowEnded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toast, showToast] = useToast();
  const [syncing, setSyncing] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['entities', q, type, onlyDebt],
    queryFn: () => api<Paginated<EntitySummary>>('/financeiro/entities', { query: { q, type, onlyWithDebt: onlyDebt || undefined, page: 1, pageSize: 200, sortBy: 'name', sortDir: 'asc' } }),
  });
  const refresh = (): void => { void qc.invalidateQueries({ queryKey: ['entities'] }); };
  const syncAll = useMutation({
    mutationFn: () => api<{ processed: number; remaining: number; succeeded: number; failed: number }>('/financeiro/sync/all', { method: 'POST' }),
    onSuccess: (r) => { showToast(`${r.succeeded} entidade(s) sincronizada(s)${r.failed ? `, ${r.failed} com falha` : ''}${r.remaining ? ` · ${r.remaining} restante(s): clique de novo ou aguarde a sincronização automática` : ''}`); refresh(); },
    onError: (e) => showToast(e instanceof ApiError ? e.message : 'Falha ao sincronizar'),
  });
  const syncOne = async (e: EntitySummary): Promise<void> => {
    setSyncing(e.id);
    try {
      await api(`/financeiro/sync/entities/${e.id}`, { method: 'POST' });
      showToast(`${e.shortName ?? e.name} sincronizada`);
      refresh();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Falha ao sincronizar');
    } finally {
      setSyncing(null);
    }
  };

  const all = data?.items ?? [];
  const list = all.filter((e) => (showEnded ? isEnded(e) : !isEnded(e)));
  const endedCount = all.filter(isEnded).length;
  const link = (e: EntitySummary, tab: string): string => `/financeiro/entidades/${e.id}?tab=${tab}`;

  return (
    <div>
      <div className="row between">
        <h1>Entidades</h1>
        <div className="row">
          {can('sync.run') && <button className="btn" onClick={() => syncAll.mutate()} disabled={syncAll.isPending}>{syncAll.isPending ? 'Sincronizando…' : 'Sincronizar todas'}</button>}
          {can('entities.write') && <button className="btn" onClick={() => setImporting(true)}>Importar CSV/XLSX</button>}
          {can('entities.write') && <button className="btn p" onClick={() => setCreating(true)}>Nova entidade</button>}
        </div>
      </div>
      <p className="sub">{showEnded ? 'Entidades sem contrato ativo' : 'Entidades com contrato ativo'} · clique no nome para abrir a ficha</p>
      <div className="row" style={{ marginBottom: 12 }}>
        <input placeholder="Buscar entidade, município, contrato ou nota…" style={{ width: 340, maxWidth: '100%' }} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Tipo">
          <option value="">Todos os tipos</option>
          {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t} — {ENTITY_TYPE_LABELS[t]}</option>)}
        </select>
        <label className="row small muted" style={{ gap: 6 }}><input type="checkbox" checked={onlyDebt} onChange={(e) => setOnlyDebt(e.target.checked)} /> Somente com débito</label>
        <label className="row small muted" style={{ gap: 6 }}><input type="checkbox" checked={showEnded} onChange={(e) => setShowEnded(e.target.checked)} /> Mostrar encerradas{endedCount ? ` (${endedCount})` : ''}</label>
      </div>
      <div className="card tbl">
        {isLoading ? <div className="bd muted">Carregando…</div> : list.length === 0 ? (
          <div className="bd"><Empty>{data?.total === 0 && !q && !type && !onlyDebt ? 'Nenhuma entidade cadastrada. Use "Importar CSV/XLSX" com o arquivo docs/samples/entidades-exemplo.csv.' : 'Nenhuma entidade encontrada'}</Empty></div>
        ) : (
          <table className="stack-m">
            <thead><tr><th>Entidade</th><th>Situação</th><th></th></tr></thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id}>
                  <td>
                    <Link href={`/financeiro/entidades/${e.id}`} style={{ fontWeight: 600, textDecoration: 'none' }}>{e.shortName ?? e.name}</Link>
                    <div className="small muted">{e.name} · {e.municipality}/{e.uf}</div>
                  </td>
                  <td>{situation(e)}</td>
                  <td>
                    <div className="acts">
                      <Link className="abtn" href={link(e, 'invoices')}><Ico d={ICON.inv} />Notas fiscais</Link>
                      <Link className="abtn" href={link(e, 'contracts')}><Ico d={ICON.con} />Contratos</Link>
                      <Link className="abtn" href={link(e, 'agenda')}><Ico d={ICON.age} />Agenda</Link>
                      <Link className="abtn" href={link(e, 'orders')}><Ico d={ICON.os} />Ordem de serviço</Link>
                      {can('sync.run') && <button className="abtn sync" onClick={() => void syncOne(e)} disabled={syncing !== null}><Ico d={ICON.sync} />{syncing === e.id ? 'Sincronizando…' : 'Sincronizar'}</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {data && <p className="small muted" style={{ marginTop: 8 }}>{list.length} entidade(s) exibida(s) de {data.total} cadastrada(s)</p>}

      <EntityForm open={creating} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); refresh(); }} />
      <ImportDialog open={importing} onClose={() => setImporting(false)} onDone={refresh} />
      {toast}
    </div>
  );
}

function EntityForm({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ type: 'CM', name: '', shortName: '', municipality: '', uf: 'MA', url: '', notes: '' });
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: async () => {
      const entity = await api<{ id: string }>('/financeiro/entities', { method: 'POST', body: { type: form.type, name: form.name, shortName: form.shortName || null, municipality: form.municipality, uf: form.uf, notes: form.notes || null } });
      if (form.url) await api(`/financeiro/entities/${entity.id}/data-sources`, { method: 'POST', body: { url: form.url } });
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
        <Field label="URL financeira (Portal do Cliente — Assesi ou Adois)" className="w"><Input {...f('url')} placeholder="https://www.assesi.com.br/adm_faturas/index.php?e=…&t=1" /></Field>
        <Field label="Observações" className="md:col-span-2"><Textarea rows={2} {...f('notes')} /></Field>
      </div>
      {error && <div className="alert crit" style={{ marginTop: 10 }}>{error}</div>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => create.mutate()} disabled={create.isPending}>Salvar</Button></div>
    </Dialog>
  );
}

interface PartnerResult { company: string | null; entities: Array<{ id: string; shortName: string; created: boolean; sourceCreated: boolean; contractCodes: string[]; invoices: number; pending: number; pendingAmount: number }>; unassigned: number; warnings: string[] }

function ImportDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ created: number; reused: number; sourcesCreated: number; errors: Array<{ line: number; error: string }> } | null>(null);
  const [partnerUrl, setPartnerUrl] = useState('');
  const [partner, setPartner] = useState<PartnerResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append('file', file!);
      return api<NonNullable<typeof result>>('/financeiro/entities/import', { method: 'POST', formData: fd });
    },
    onSuccess: (r) => { setResult(r); setError(null); onDone(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Falha na importação'),
  });
  const importPartner = useMutation({
    mutationFn: () => api<PartnerResult>('/financeiro/entities/import-partner', { method: 'POST', body: { url: partnerUrl.trim() } }),
    onSuccess: (r) => { setPartner(r); setError(null); onDone(); },
    onError: (e) => setError(e instanceof ApiError ? `${e.message}${e.issues?.length ? ': ' + e.issues.map((i) => i.message).join('; ') : ''}` : 'Falha ao ler o link de parceiro'),
  });
  return (
    <Dialog open={open} onClose={onClose} title="Importar entidades">
      <div className="card" style={{ padding: '12px 14px', marginBottom: 12 }}>
        <h2>Planilha CSV/XLSX</h2>
        <p className="small muted" style={{ margin: '6px 0 8px' }}>Colunas: <code>tipo, entidade, municipio, uf, url, nome_completo</code>. A URL pode ser do portal da Assesi ou da Adois (link de entidade, <code>t=1</code>).</p>
        <div className="row">
          <input type="file" accept=".csv,.xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <Button onClick={() => upload.mutate()} disabled={!file || upload.isPending}>{upload.isPending ? 'Importando…' : 'Importar planilha'}</Button>
        </div>
        {result && (
          <div className="alert info" style={{ marginTop: 12, marginBottom: 0 }}>
            <div>Criadas: {result.created} · Reaproveitadas: {result.reused} · Fontes cadastradas: {result.sourcesCreated}</div>
            {result.errors.length > 0 && <ul className="mt-2 list-disc pl-5" style={{ color: 'var(--crit)' }}>{result.errors.map((e) => <li key={e.line}>Linha {e.line}: {e.error}</li>)}</ul>}
          </div>
        )}
      </div>
      <div className="card" style={{ padding: '12px 14px' }}>
        <h2>Link de parceiro (Adois)</h2>
        <p className="small muted" style={{ margin: '6px 0 8px' }}>Link <code>…/adm_faturas/index.php?e=…&amp;t=2</code> com as notas de uma empresa parceira para vários municípios. O sistema identifica cada prefeitura/câmara pelas notas e cadastra uma entidade para cada uma.</p>
        <div className="row">
          <input placeholder="https://adoissolucoes.com/adm_faturas/index.php?e=…&t=2" value={partnerUrl} onChange={(e) => setPartnerUrl(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
          <Button onClick={() => importPartner.mutate()} disabled={!partnerUrl.trim() || importPartner.isPending}>{importPartner.isPending ? 'Lendo o portal…' : 'Importar parceiro'}</Button>
        </div>
        {partner && (
          <div className="alert info" style={{ marginTop: 12, marginBottom: 0 }}>
            <div><b>{partner.company ?? 'Parceiro'}</b>: {partner.entities.length} entidade(s) encontrada(s) · {partner.entities.filter((e) => e.created).length} nova(s)</div>
            <ul className="hist" style={{ marginTop: 6 }}>
              {partner.entities.map((e) => (
                <li key={e.id} className="row between">
                  <span><Link href={`/financeiro/entidades/${e.id}`}>{e.shortName}</Link> <span className="small muted">· {e.invoices} nota(s), {e.pending} pendente(s) · {formatBRL(e.pendingAmount)} · contrato(s) {e.contractCodes.join(', ')}</span></span>
                  <span className="pill n">{e.created ? 'nova' : e.sourceCreated ? 'fonte adicionada' : 'já cadastrada'}</span>
                </li>
              ))}
            </ul>
            {partner.unassigned > 0 && <div className="small" style={{ color: 'var(--warn)', marginTop: 6 }}>{partner.unassigned} nota(s) sem entidade identificável na descrição foram ignoradas.</div>}
            {partner.warnings.length > 0 && <ul className="small muted" style={{ marginTop: 6, paddingLeft: 18 }}>{partner.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
            <div className="small muted" style={{ marginTop: 6 }}>Clique em <b>Sincronizar todas</b> (ou em Sincronizar na entidade) para trazer as notas.</div>
          </div>
        )}
      </div>
      {error && <div className="alert crit" style={{ marginTop: 10 }}>{error}</div>}
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><Button variant="secondary" onClick={onClose}>Fechar</Button></div>
    </Dialog>
  );
}
