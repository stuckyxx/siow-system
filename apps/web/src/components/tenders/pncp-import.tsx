'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { TENDER_MODALITY_LABELS, formatBRL, formatBrDate, formatBrDateTime, todayIso, addDaysIso, type PncpPublication, type TenderModality } from '@siow/shared';
import { api } from '@/lib/api';
import { Button, Dialog, Field, Input, Select, Table, Td, Th } from '@/components/ui';
import { errMsg } from './tender-form';

const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
const MODS: Array<[number, string]> = [[6, 'Pregão eletrônico'], [7, 'Pregão presencial'], [4, 'Concorrência eletrônica'], [5, 'Concorrência presencial'], [8, 'Dispensa'], [9, 'Inexigibilidade'], [12, 'Credenciamento'], [1, 'Leilão'], [3, 'Concurso'], [2, 'Diálogo competitivo']];

/** Busca no PNCP (consulta pública) → prévia com casamento de entidade e duplicidade → importa as selecionadas. */
export function PncpImportDialog({ onClose, onDone }: { onClose: () => void; onDone: (r: { created: number; skipped: number; entitiesCreated: number; errors: string[] }) => void }) {
  const [f, setF] = useState({ uf: 'MA', from: addDaysIso(todayIso(), -7), to: todayIso(), modalities: [6, 8, 4] as number[], q: '', onlyLinkedEntities: false, source: 'PNCP' as 'PNCP' | 'COMPRASGOV' });
  const [result, setResult] = useState<{ items: PncpPublication[]; warnings: string[]; total: number } | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const { data: entities } = useQuery({ queryKey: ['entities-lite'], queryFn: () => api<{ entities: Array<{ id: string; name: string; shortName: string | null }> }>('/financeiro/dashboard/filter-options') });
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const search = useMutation({ mutationFn: () => api<{ items: PncpPublication[]; warnings: string[]; total: number }>('/licitacoes/pncp/search', { method: 'POST', body: { ...f, q: f.q || null } }), onSuccess: (r) => { setResult(r); setSel(new Set(r.items.filter((i) => !i.match.alreadyImportedId).map((i) => i.officialId))); setError(null); }, onError: (e) => setError(errMsg(e)) });
  const imp = useMutation({ mutationFn: () => api<{ created: number; skipped: number; entitiesCreated: number; errors: string[] }>('/licitacoes/pncp/import', { method: 'POST', body: { uf: f.uf, from: f.from, to: f.to, modalities: f.modalities, source: f.source, items: [...sel].map((id) => ({ officialId: id, entityId: overrides[id] || result?.items.find((i) => i.officialId === id)?.match.entityId || null, createEntity: true })) } }), onSuccess: onDone, onError: (e) => setError(errMsg(e)) });
  const toggleMod = (m: number) => setF({ ...f, modalities: f.modalities.includes(m) ? f.modalities.filter((x) => x !== m) : [...f.modalities, m] });
  return (
    <Dialog open onClose={onClose} title="Importar do PNCP (Portal Nacional de Contratações Públicas)" wide>
      <p className="small muted">Consulta pública, somente leitura. Cada publicação é identificada pelo número de controle do PNCP: o que já existe no sistema não é importado de novo. Órgãos sem entidade cadastrada viram entidade LEAD (prefeitura ou câmara, pelo nome do órgão).</p>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="UF"><Select value={f.uf} onChange={(e) => setF({ ...f, uf: e.target.value })}>{UFS.map((u) => <option key={u} value={u}>{u}</option>)}</Select></Field>
        <Field label="Publicadas de"><Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
        <Field label="até"><Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
        <Field label="Filtrar objeto/órgão"><Input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="software, sistema, portal…" /></Field>
      </div>
      <div className="row small" style={{ margin: '8px 0', gap: 10 }}>{MODS.map(([code, label]) => <label key={code} className="row" style={{ gap: 4 }}><input type="checkbox" checked={f.modalities.includes(code)} onChange={() => toggleMod(code)} /> {label}</label>)}</div>
      <div className="row" style={{ marginBottom: 8 }}><label className="row small" style={{ gap: 4 }}><input type="checkbox" checked={f.onlyLinkedEntities} onChange={(e) => setF({ ...f, onlyLinkedEntities: e.target.checked })} /> Só órgãos que já são entidades cadastradas</label><select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value as 'PNCP' | 'COMPRASGOV' })} aria-label="Fonte"><option value="PNCP">Fonte: PNCP</option><option value="COMPRASGOV">Fonte: Compras.gov.br</option></select><Button onClick={() => search.mutate()} disabled={search.isPending || f.modalities.length === 0}>{search.isPending ? `Consultando ${f.source === 'COMPRASGOV' ? 'Compras.gov' : 'PNCP'}…` : 'Buscar'}</Button></div>
      {error && <div className="alert crit">{error}</div>}
      {result && (
        <div>
          <div className="small muted" style={{ marginBottom: 6 }}>{result.total} publicação(ões){result.warnings.length ? ` · avisos: ${result.warnings.join(' | ')}` : ''} · {sel.size} selecionada(s)</div>
          <div className="tbl" style={{ maxHeight: 380, overflow: 'auto' }}><Table>
            <thead><tr><Th /><Th>Órgão</Th><Th>Modalidade / nº</Th><Th>Objeto</Th><Th className="r">Estimado</Th><Th>Proposta até</Th><Th>Entidade</Th></tr></thead>
            <tbody>{result.items.map((p) => (
              <tr key={p.officialId} style={{ opacity: p.match.alreadyImportedId ? 0.5 : 1 }}>
                <Td>{p.match.alreadyImportedId ? <span className="small muted">já importada</span> : <input type="checkbox" checked={sel.has(p.officialId)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(p.officialId); else n.delete(p.officialId); setSel(n); }} />}</Td>
                <Td className="small"><b>{p.orgName}</b><div className="muted">{p.municipality}/{p.uf}{p.publishedAt ? ` · publ. ${formatBrDate(p.publishedAt)}` : ''}</div></Td>
                <Td className="small">{TENDER_MODALITY_LABELS[p.modality as TenderModality] ?? p.modality}<div className="muted">{p.number}{p.year ? `/${p.year}` : ''}</div></Td>
                <Td className="small" style={{ maxWidth: 320 }}>{p.object.slice(0, 180)}{p.object.length > 180 ? '…' : ''}{p.portalUrl && <div><a href={p.portalUrl} target="_blank" rel="noopener noreferrer" className="link">portal</a></div>}</Td>
                <Td className="r num small">{p.estimatedValue ? formatBRL(p.estimatedValue) : '—'}</Td>
                <Td className="small num">{p.proposalDeadline ? formatBrDateTime(p.proposalDeadline) : '—'}</Td>
                <Td className="small">{p.match.entityId ? <span>{p.match.entityName}</span> : <Select value={overrides[p.officialId] ?? ''} onChange={(e) => setOverrides({ ...overrides, [p.officialId]: e.target.value })} style={{ minWidth: 180 }}><option value="">Criar como lead</option>{entities?.entities.map((e) => <option key={e.id} value={e.id}>{e.shortName ?? e.name}</option>)}</Select>}</Td>
              </tr>))}</tbody>
          </Table></div>
          <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Fechar</Button><Button onClick={() => imp.mutate()} disabled={imp.isPending || sel.size === 0}>{imp.isPending ? 'Importando…' : `Importar ${sel.size} licitação(ões)`}</Button></div>
        </div>
      )}
    </Dialog>
  );
}
