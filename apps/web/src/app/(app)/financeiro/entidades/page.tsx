'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { ENTITY_TYPES, ENTITY_TYPE_LABELS, formatBRL, type EntitySummary, type Paginated } from '@siow/shared';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { downloadBlob } from '@/lib/utils';
import { Button, Dialog, Empty, Field, Input, Select, Textarea, useToast } from '@/components/ui';

const ICON = {
  edit: 'M4 20h4l10-10-4-4L4 16zM13 7l4 4M15 5l2-2 4 4-2 2',
  del: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6',
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
  const [syncFilter, setSyncFilter] = useState<'' | 'synced' | 'unsynced'>('');
  type YesNo = '' | 'yes' | 'no';
  const [withContracts, setWithContracts] = useState<YesNo>('');
  const [withInvoices, setWithInvoices] = useState<YesNo>('');
  const [withUrl, setWithUrl] = useState<YesNo>('');
  const [editing, setEditing] = useState<EntitySummary | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toast, showToast] = useToast();
  const [syncing, setSyncing] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['entities', q, type, onlyDebt],
    queryFn: () => api<Paginated<EntitySummary>>('/financeiro/entities', { query: { q, type, onlyWithDebt: onlyDebt || undefined, page: 1, pageSize: 200, sortBy: 'name', sortDir: 'asc' } }),
  });
  const refresh = (): void => { void qc.invalidateQueries({ queryKey: ['entities'] }); };
  const remove = useMutation({
    mutationFn: (e: EntitySummary) => api<{ ok: boolean }>(`/financeiro/entities/${e.id}`, { method: 'DELETE' }),
    onSuccess: (_r, e) => { showToast(`${e.shortName ?? e.name} excluída`); refresh(); },
    onError: (err) => showToast(err instanceof ApiError ? err.message : 'Falha ao excluir'),
  });
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
  const bySync = (e: EntitySummary): boolean => syncFilter === '' ? true : syncFilter === 'synced' ? e.lastSyncAt !== null : e.lastSyncAt === null;
  const yesNo = (v: YesNo, n: number): boolean => v === '' ? true : v === 'yes' ? n > 0 : n === 0;
  const list = all
    .filter((e) => (showEnded ? isEnded(e) : !isEnded(e)))
    .filter(bySync)
    .filter((e) => yesNo(withContracts, e.contractCount) && yesNo(withInvoices, e.invoiceCount) && yesNo(withUrl, e.sourceCount));
  const cnt = (pred: (e: EntitySummary) => boolean): number => all.filter(pred).length;
  const endedCount = all.filter(isEnded).length;
  const syncedCount = all.filter((e) => e.lastSyncAt !== null).length;
  const unsyncedCount = all.length - syncedCount;
  const link = (e: EntitySummary, tab: string): string => `/financeiro/entidades/${e.id}?tab=${tab}`;

  return (
    <div>
      <div className="row between">
        <h1>Entidades</h1>
        <div className="row">
          {can('sync.run') && <button className="btn" onClick={() => syncAll.mutate()} disabled={syncAll.isPending}>{syncAll.isPending ? 'Sincronizando…' : 'Sincronizar todas'}</button>}
          {can('entities.write') && <button className="btn" onClick={() => setImporting(true)}>Importar entidade</button>}
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
        <select value={syncFilter} onChange={(e) => setSyncFilter(e.target.value as '' | 'synced' | 'unsynced')} aria-label="Sincronização">
          <option value="">Sincronizadas e não sincronizadas</option>
          <option value="synced">Sincronizadas ({syncedCount})</option>
          <option value="unsynced">Não sincronizadas ({unsyncedCount})</option>
        </select>
        <select value={withContracts} onChange={(e) => setWithContracts(e.target.value as YesNo)} aria-label="Contratos">
          <option value="">Com ou sem contratos</option>
          <option value="yes">Com contratos ({cnt((e) => e.contractCount > 0)})</option>
          <option value="no">Sem contratos ({cnt((e) => e.contractCount === 0)})</option>
        </select>
        <select value={withInvoices} onChange={(e) => setWithInvoices(e.target.value as YesNo)} aria-label="Notas">
          <option value="">Com ou sem notas</option>
          <option value="yes">Com notas vinculadas ({cnt((e) => e.invoiceCount > 0)})</option>
          <option value="no">Sem notas vinculadas ({cnt((e) => e.invoiceCount === 0)})</option>
        </select>
        <select value={withUrl} onChange={(e) => setWithUrl(e.target.value as YesNo)} aria-label="Link">
          <option value="">Com ou sem link de URL</option>
          <option value="yes">Com link de URL ({cnt((e) => e.sourceCount > 0)})</option>
          <option value="no">Sem link de URL ({cnt((e) => e.sourceCount === 0)})</option>
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
                      {can('entities.write') && <button className="abtn" onClick={() => setEditing(e)}><Ico d={ICON.edit} />Editar</button>}
                      {can('entities.write') && e.invoiceCount === 0 && (
                        <button className="abtn danger" title="Só é possível excluir entidades sem notas vinculadas" disabled={remove.isPending} onClick={() => { if (window.confirm(`Excluir a entidade "${e.shortName ?? e.name}"? Ela não possui notas vinculadas.`)) remove.mutate(e); }}><Ico d={ICON.del} />Excluir</button>
                      )}
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
      {editing && <EntityForm open entity={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); showToast('Entidade atualizada'); refresh(); }} />}
      <ImportDialog open={importing} onClose={() => setImporting(false)} onDone={refresh} />
      {toast}
    </div>
  );
}

function EntityForm({ open, entity, onClose, onSaved }: { open: boolean; entity?: EntitySummary; onClose: () => void; onSaved: () => void }) {
  const editing = Boolean(entity);
  const [form, setForm] = useState({ type: entity?.type ?? 'CM', name: entity?.name ?? '', shortName: entity?.shortName ?? '', municipality: entity?.municipality ?? '', uf: entity?.uf ?? 'MA', url: '', notes: '', isActive: entity?.isActive ?? true });
  const [error, setError] = useState<string | null>(null);
  // Observações e fonte atual só existem na ficha completa; carrega ao editar.
  const { data: detail } = useQuery({
    queryKey: ['entity', entity?.id],
    queryFn: () => api<{ notes: string | null; dataSources: Array<{ url: string }> }>(`/financeiro/entities/${entity!.id}`),
    enabled: editing,
  });
  useEffect(() => { if (detail) setForm((f) => ({ ...f, notes: detail.notes ?? '', url: f.url || (detail.dataSources[0]?.url ?? '') })); }, [detail]);
  const save = useMutation({
    mutationFn: async () => {
      const body = { type: form.type, name: form.name, shortName: form.shortName || null, municipality: form.municipality, uf: form.uf, notes: form.notes || null, isActive: form.isActive };
      if (editing) {
        await api(`/financeiro/entities/${entity!.id}`, { method: 'PATCH', body });
        if (form.url && form.url !== (detail?.dataSources[0]?.url ?? '')) await api(`/financeiro/entities/${entity!.id}/data-sources`, { method: 'POST', body: { url: form.url } });
      } else {
        const created = await api<{ id: string }>('/financeiro/entities', { method: 'POST', body });
        if (form.url) await api(`/financeiro/entities/${created.id}/data-sources`, { method: 'POST', body: { url: form.url } });
      }
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? `${e.message}${e.issues ? ': ' + e.issues.map((i) => `${i.path} ${i.message}`).join('; ') : ''}` : 'Erro'),
  });
  const f = (k: 'type' | 'name' | 'shortName' | 'municipality' | 'uf' | 'url' | 'notes') => ({ value: form[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value }) });
  return (
    <Dialog open={open} onClose={onClose} title={editing ? `Editar entidade — ${entity!.shortName ?? entity!.name}` : 'Nova entidade'}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Tipo"><Select {...f('type')}>{ENTITY_TYPES.map((t) => <option key={t} value={t}>{t} — {ENTITY_TYPE_LABELS[t]}</option>)}</Select></Field>
        <Field label="UF"><Input maxLength={2} {...f('uf')} /></Field>
        <Field label="Município"><Input {...f('municipality')} placeholder="Bom Lugar" /></Field>
        <Field label="Nome curto"><Input {...f('shortName')} placeholder="CM BOM LUGAR" /></Field>
        <Field label="Nome completo" className="md:col-span-2"><Input {...f('name')} placeholder="CÂMARA MUNICIPAL DE BOM LUGAR" /></Field>
        <Field label={editing && detail?.dataSources[0] ? 'URL financeira atual (altere para cadastrar outra fonte)' : 'URL financeira (Portal do Cliente — Assesi ou Adois)'} className="w"><Input {...f('url')} placeholder="https://www.assesi.com.br/adm_faturas/index.php?e=…&t=1" /></Field>
        <Field label="Observações" className="md:col-span-2"><Textarea rows={2} {...f('notes')} /></Field>
        {editing && <label className="row small muted md:col-span-2" style={{ gap: 6 }}><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Entidade ativa (desmarque quando o contrato terminar; ela passa a aparecer em "encerradas")</label>}
      </div>
      {error && <div className="alert crit" style={{ marginTop: 10 }}>{error}</div>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar'}</Button></div>
    </Dialog>
  );
}

interface ImportedEntity { id: string; shortName: string; created: boolean; sourceCreated: boolean; contractCodes: string[]; invoices: number; pending: number; pendingAmount: number }
interface LinkResult { kind: 'partner' | 'entity'; company: string | null; entities: ImportedEntity[]; unassigned: number; warnings: string[] }
type SyncState = { status: 'sincronizando' | 'ok' | 'erro'; pending?: number; paid?: number; total?: number; debt?: string; message?: string };

/**
 * Importar entidade: cola-se o link web do Portal do Cliente (Assesi, Adois ou parceiro Adois).
 * 1) POST import-link cadastra a(s) entidade(s) e fonte(s); 2) a tela sincroniza cada uma (uma requisição por
 * entidade, respeitando o limite de tempo por função) e mostra pendentes / pagas / total lidos do portal.
 */
async function downloadTemplate(url?: string): Promise<void> {
  const blob = await api<Blob>('/financeiro/entities/import-template', { raw: true, query: url ? { url } : undefined });
  downloadBlob(blob, url ? 'entidades-do-link.xlsx' : 'modelo-importacao-entidades.xlsx');
}

function ImportDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [url, setUrl] = useState('');
  const [result, setResult] = useState<LinkResult | null>(null);
  const [sync, setSync] = useState<Record<string, SyncState>>({});
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [csv, setCsv] = useState<{ created: number; reused: number; sourcesCreated: number; invoicesCreated?: number; invoicesSkipped?: number; errors: Array<{ line: number; error: string }> } | null>(null);
  const [downloading, setDownloading] = useState(false);

  const syncAll = async (entities: ImportedEntity[]): Promise<void> => {
    for (const e of entities) {
      setSync((s) => ({ ...s, [e.id]: { status: 'sincronizando' } }));
      try {
        await api(`/financeiro/sync/entities/${e.id}`, { method: 'POST' });
        const d = await api<{ overview: { pendingInvoices: number; paidInvoices: number; debtTotal: string } | null }>(`/financeiro/entities/${e.id}`);
        const o = d.overview;
        setSync((s) => ({ ...s, [e.id]: { status: 'ok', pending: o?.pendingInvoices ?? 0, paid: o?.paidInvoices ?? 0, total: (o?.pendingInvoices ?? 0) + (o?.paidInvoices ?? 0), debt: o?.debtTotal ?? '0' } }));
      } catch (err) {
        setSync((s) => ({ ...s, [e.id]: { status: 'erro', message: err instanceof ApiError ? err.message : 'falha ao sincronizar' } }));
      }
      onDone();
    }
  };
  const importLink = useMutation({
    mutationFn: () => api<LinkResult>('/financeiro/entities/import-link', { method: 'POST', body: { url: url.trim() } }),
    onSuccess: (r) => { setResult(r); setSync({}); setError(null); onDone(); void syncAll(r.entities); },
    onError: (e) => setError(e instanceof ApiError ? `${e.message}${e.issues?.length ? ': ' + e.issues.map((i) => i.message).join('; ') : ''}` : 'Falha ao ler o link'),
  });
  const upload = useMutation({
    mutationFn: async () => { const fd = new FormData(); fd.append('file', file!); return api<NonNullable<typeof csv>>('/financeiro/entities/import', { method: 'POST', formData: fd }); },
    onSuccess: (r) => { setCsv(r); setError(null); onDone(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Falha na importação'),
  });

  return (
    <Dialog open={open} onClose={onClose} title="Importar entidade" wide>
      <p className="small muted" style={{ marginTop: 0 }}>Cole o <b>link web</b> do Portal do Cliente. Serve para link de entidade (Assesi ou Adois) e para link de parceiro da Adois (<code>t=2</code>), que cadastra uma entidade para cada município encontrado. Depois de cadastrar, o sistema já busca as notas pendentes, pagas e todas.</p>
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (url.trim()) importLink.mutate(); }}>
        <input placeholder="https://www.assesi.com.br/adm_faturas/index.php?e=…&t=1" value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: 1, minWidth: 260 }} aria-label="Link web" />
        <Button type="submit" disabled={!url.trim() || importLink.isPending}>{importLink.isPending ? 'Lendo o portal…' : 'Importar'}</Button>
        <Button type="button" variant="secondary" disabled={!url.trim() || downloading} onClick={() => { setDownloading(true); downloadTemplate(url.trim()).catch((e) => setError(e instanceof ApiError ? e.message : 'Falha ao gerar a planilha')).finally(() => setDownloading(false)); }}>{downloading ? 'Gerando…' : '⬇ Baixar planilha do link'}</Button>
      </form>
      <p className="small muted" style={{ margin: '6px 0 0' }}>"Baixar planilha do link" gera um XLSX já preenchido com a(s) entidade(s) e todas as notas do portal (nº, competência, exercício, valor, emissão, situação, pagamento, atraso, contrato), sem cadastrar nada — para conferir ou importar depois.</p>
      {result && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="hd"><h2>{result.kind === 'partner' ? `Parceiro ${result.company ?? ''}` : 'Entidade do link'} · {result.entities.length} entidade(s)</h2><span className="small muted">{result.entities.filter((e) => e.created).length} nova(s)</span></div>
          <div className="tbl">
            <table>
              <thead><tr><th>Entidade</th><th>Cadastro</th><th className="r">Pendentes</th><th className="r">Pagas</th><th className="r">Todas</th><th>Sincronização</th></tr></thead>
              <tbody>
                {result.entities.map((e) => {
                  const st = sync[e.id];
                  return (
                    <tr key={e.id}>
                      <td><Link href={`/financeiro/entidades/${e.id}`}>{e.shortName}</Link>{e.contractCodes.length > 0 && <div className="small muted">contrato(s) {e.contractCodes.join(', ')}</div>}</td>
                      <td><span className="pill n">{e.created ? 'nova' : e.sourceCreated ? 'fonte adicionada' : 'já cadastrada'}</span></td>
                      <td className="r num" style={{ color: 'var(--warn)' }}>{st?.status === 'ok' ? `${st.pending} · ${formatBRL(st.debt)}` : `${e.pending} · ${formatBRL(e.pendingAmount)}`}</td>
                      <td className="r num" style={{ color: 'var(--good)' }}>{st?.status === 'ok' ? st.paid : e.invoices - e.pending}</td>
                      <td className="r num">{st?.status === 'ok' ? st.total : e.invoices}</td>
                      <td>{!st ? <span className="muted small">aguardando</span> : st.status === 'sincronizando' ? <span className="pill info">sincronizando…</span> : st.status === 'ok' ? <span className="pill good">concluída</span> : <span className="pill crit" title={st.message}>falhou</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {result.unassigned > 0 && <div className="bd small" style={{ color: 'var(--warn)' }}>{result.unassigned} nota(s) do link sem entidade identificável na descrição foram ignoradas.</div>}
          {result.warnings.length > 0 && <ul className="small muted" style={{ margin: '0 18px 12px', paddingLeft: 18 }}>{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
        </div>
      )}
      <details style={{ marginTop: 14 }}>
        <summary className="small" style={{ cursor: 'pointer', color: 'var(--accent)' }}>Importar várias por planilha (CSV/XLSX)</summary>
        <p className="small muted" style={{ margin: '6px 0 8px' }}>Baixe o modelo, preencha uma linha por entidade (<code>tipo, entidade, municipio, uf, url, nome_completo</code> — a aba "Instruções" explica cada coluna) e envie o arquivo.</p>
        <div className="row" style={{ marginBottom: 8 }}>
          <Button variant="secondary" onClick={() => downloadTemplate().catch((e) => setError(e instanceof ApiError ? e.message : 'Falha ao baixar o modelo'))}>⬇ Baixar modelo (XLSX)</Button>
        </div>
        <div className="row">
          <input type="file" accept=".csv,.xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <Button variant="secondary" onClick={() => upload.mutate()} disabled={!file || upload.isPending}>{upload.isPending ? 'Importando…' : 'Importar planilha'}</Button>
        </div>
        {csv && (
          <div className="alert info" style={{ marginTop: 10, marginBottom: 0 }}>
            <div>Entidades criadas: {csv.created} · reaproveitadas: {csv.reused} · fontes cadastradas: {csv.sourcesCreated}{csv.invoicesCreated !== undefined ? ` · notas importadas: ${csv.invoicesCreated} (${csv.invoicesSkipped ?? 0} já existiam)` : ''}</div>
            {csv.errors.length > 0 && <ul className="mt-2 list-disc pl-5" style={{ color: 'var(--crit)' }}>{csv.errors.map((e) => <li key={e.line}>Linha {e.line}: {e.error}</li>)}</ul>}
          </div>
        )}
      </details>
      {error && <div className="alert crit" style={{ marginTop: 10 }}>{error}</div>}
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><Button variant="secondary" onClick={onClose}>Fechar</Button></div>
    </Dialog>
  );
}
