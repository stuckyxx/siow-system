'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useRef, useState } from 'react';
import { TENDER_DEADLINE_KIND_LABELS, toBrDateTimeInput, type TenderDeadlineKind } from '@siow/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, useToast } from '@/components/ui';
import { TendersTable } from '@/components/tenders/tenders-table';
import { TenderForm, errMsg } from '@/components/tenders/tender-form';
import { PncpImportDialog } from '@/components/tenders/pncp-import';

export default function TendersPage() { return <Suspense fallback={<div className="muted">Carregando…</div>}><View /></Suspense>; }

function View() {
  const router = useRouter();
  const search = useSearchParams();
  const qc = useQueryClient();
  const { can } = useAuth();
  const [toast, showToast] = useToast();
  const [view, setViewState] = useState(search.get('view') === 'calendario' ? 'calendario' : 'lista');
  const [creating, setCreating] = useState(false);
  const [pncp, setPncp] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const setView = (v: string): void => { setViewState(v); router.replace(`/licitacoes?view=${v}`, { scroll: false }); };
  const refresh = (): void => { void qc.invalidateQueries({ queryKey: ['tenders'] }); void qc.invalidateQueries({ queryKey: ['tender-calendar'] }); };
  const sheet = useMutation({ mutationFn: (file: File) => { const fd = new FormData(); fd.append('file', file); return api<{ created: number; skipped: number; errors: Array<{ line: number; error: string }> }>('/licitacoes/import-sheet', { method: 'POST', formData: fd }); }, onSuccess: (r) => { showToast(`Planilha: ${r.created} criada(s), ${r.skipped} já existente(s)${r.errors.length ? `, ${r.errors.length} erro(s): ${r.errors.slice(0, 3).map((e) => `linha ${e.line} ${e.error}`).join('; ')}` : ''}`); refresh(); }, onError: (e) => showToast(errMsg(e)) });
  return (
    <div>
      <div className="row between"><div><h1>Licitações</h1><p className="sub">Pregões, concorrências, dispensas e credenciamentos: prazos, checklist de habilitação ligado às certidões, concorrentes, resultado e homologação → contrato.</p></div>
        <div className="row">
          {can('tenders.write') && <Button variant="secondary" onClick={() => setPncp(true)}>Importar do PNCP</Button>}
          {can('tenders.write') && <><input ref={fileRef} type="file" accept=".csv,.xlsx" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) sheet.mutate(f); e.target.value = ''; }} /><Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={sheet.isPending}>{sheet.isPending ? 'Importando…' : 'Importar planilha'}</Button></>}
          {can('tenders.write') && <Button onClick={() => setCreating(true)}>+ Nova licitação</Button>}
        </div></div>
      <div className="seg" style={{ margin: '12px 0' }}><button className={view === 'lista' ? 'on' : ''} onClick={() => setView('lista')}>Lista</button><button className={view === 'calendario' ? 'on' : ''} onClick={() => setView('calendario')}>Calendário de prazos</button></div>
      {view === 'lista' ? <TendersTable /> : <TenderCalendar />}
      {creating && <TenderForm onClose={() => setCreating(false)} onSaved={(t) => { setCreating(false); refresh(); router.push(`/licitacoes/${t.id}`); }} />}
      {pncp && <PncpImportDialog onClose={() => setPncp(false)} onDone={(r) => { setPncp(false); refresh(); showToast(`PNCP: ${r.created} importada(s), ${r.skipped} já existente(s), ${r.entitiesCreated} entidade(s) criada(s)${r.errors.length ? `, erros: ${r.errors.slice(0, 2).join('; ')}` : ''}`); }} />}
      <p className="small muted" style={{ marginTop: 10 }}>Planilha: colunas <code>entidade, modalidade, numero, objeto, valor_estimado, proposta, sessao, url, id_oficial</code> (datas dd/mm/aaaa hh:mm).</p>
      {toast}
    </div>
  );
}

function TenderCalendar() {
  const [month, setMonth] = useState(toBrDateTimeInput(new Date()).slice(0, 7));
  const [y, m] = month.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1)); const last = new Date(Date.UTC(y, m, 0));
  const { data } = useQuery({ queryKey: ['tender-calendar', month], queryFn: () => api<Array<{ id: string; tenderId: string; tenderNumber: string; entityName: string; kind: string; title: string; dueAt: string; done: boolean }>>('/licitacoes/calendar', { query: { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) } }) });
  const today = toBrDateTimeInput(new Date()).slice(0, 10);
  const byDay = new Map<string, NonNullable<typeof data>>();
  for (const d of data ?? []) { const k = toBrDateTimeInput(d.dueAt).slice(0, 10); byDay.set(k, [...(byDay.get(k) ?? []), d]); }
  const cells: Array<string | null> = [...Array<null>(first.getUTCDay()).fill(null), ...Array.from({ length: last.getUTCDate() }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  const shift = (d: number): void => { const n = new Date(Date.UTC(y, m - 1 + d, 1)); setMonth(n.toISOString().slice(0, 7)); };
  return (
    <div>
      <div className="row between" style={{ marginBottom: 8 }}><div className="row"><Button size="sm" variant="secondary" onClick={() => shift(-1)}>‹</Button><b style={{ minWidth: 140, textAlign: 'center' }}>{first.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</b><Button size="sm" variant="secondary" onClick={() => shift(1)}>›</Button></div><span className="small muted">Prazos de todas as licitações (proposta, sessão, recurso, assinatura…). Alertas {`${3}`} dias antes e quando vencidos.</span></div>
      <div className="cal">
        {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d) => <div key={d} className="small muted" style={{ textAlign: 'center' }}>{d}</div>)}
        {cells.map((d, i) => d === null ? <div key={`p${i}`} /> : (
          <div key={d} className={`cd ${d === today ? 'today' : ''}`}><div className="dn">{Number(d.slice(8))}</div>
            {(byDay.get(d) ?? []).map((e) => <Link key={e.id} href={`/licitacoes/${e.tenderId}`} className={`ev ${e.done ? 'done' : d < today ? 'late' : ''}`} title={`${TENDER_DEADLINE_KIND_LABELS[e.kind as TenderDeadlineKind] ?? e.kind}: ${e.title} · ${e.entityName}`}>{toBrDateTimeInput(e.dueAt).slice(11, 16)} {e.tenderNumber} · {e.title}</Link>)}
          </div>))}
      </div>
    </div>
  );
}
