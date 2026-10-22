'use client';
/**
 * Mapa de cobertura comercial (Fase 15): municípios de MA, PI e TO pintados pela situação comercial,
 * capitais em destaque (ponto de saída da equipe), filtro por estado com zoom, legenda clicável, tooltip,
 * painel lateral do município, cobertura por estado, lista de municípios com atuação e busca sem acento.
 * Contornos: arquivo estático /geo/mapa-ma-pi-to.json (IBGE, já projetado em caminhos SVG) — sem biblioteca de mapa.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ENTITY_TYPE_LABELS, type EntityType } from '@siow/shared';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Empty, Input, Select, Skeleton, Textarea } from '@/components/ui';

type Status = 'ATIVO' | 'IMPLANTACAO' | 'NEGOCIACAO' | 'NENHUMA';
type Manual = 'IMPLANTACAO' | 'NEGOCIACAO' | 'NENHUMA';
interface GeoMun { id: string; n: string; uf: string; d: string; c: [number, number]; cap?: 1 }
interface GeoState { uf: string; name: string; d: string; box: [number, number, number, number]; count: number }
interface Geo { viewBox: [number, number, number, number]; states: GeoState[]; municipalities: GeoMun[] }
interface CovEntity { id: string; name: string; shortName: string | null; type: string; activeContracts: number }
interface CovMun { ibge: string; uf: string; name: string; capital: boolean; status: Status; manualStatus: Manual | null; hasActiveContract: boolean; notes: string | null; updatedAt: string | null; entities: CovEntity[]; modules: string[] }
interface CovSummary { uf: string; total: number; ativo: number; implantacao: number; negociacao: number; livres: number; atendidosPct: number }
interface CovMap { municipalities: CovMun[]; summary: CovSummary[]; entitiesWithoutIbge: number; ibgeMismatches: Array<{ id: string; name: string; municipality: string; uf: string; ibgeCode: string; ibgeName: string | null }> }

const STATUS: Record<Status, { label: string; color: string }> = {
  ATIVO: { label: 'Cliente ativo', color: 'var(--cov-ativo)' },
  IMPLANTACAO: { label: 'Em implantação', color: 'var(--cov-implantacao)' },
  NEGOCIACAO: { label: 'Em negociação', color: 'var(--cov-negociacao)' },
  NENHUMA: { label: 'Sem atuação', color: 'var(--cov-nenhuma)' },
};
const ORDER: Status[] = ['ATIVO', 'IMPLANTACAO', 'NEGOCIACAO', 'NENHUMA'];
const UF_NAMES: Record<string, string> = { MA: 'Maranhão', PI: 'Piauí', TO: 'Tocantins' };
const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
type LegendKey = Status | 'CAPITAL';

export function CoverageMap() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const geo = useQuery({ queryKey: ['geo-ma-pi-to'], queryFn: async () => { const r = await fetch('/geo/mapa-ma-pi-to.json'); if (!r.ok) throw new Error('Falha ao carregar o mapa'); return (await r.json()) as Geo; }, staleTime: Infinity, gcTime: Infinity });
  const cov = useQuery({ queryKey: ['coverage-map'], queryFn: () => api<CovMap>('/comercial/mapa') });
  const [uf, setUf] = useState<string>('');
  const [hidden, setHidden] = useState<Set<LegendKey>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; id: string } | null>(null);
  const [q, setQ] = useState('');
  const [qIdx, setQIdx] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const [px, setPx] = useState<[number, number]>([800, 900]);
  useEffect(() => {
    const el = svgRef.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => { if (e) setPx([e.contentRect.width || 800, e.contentRect.height || 900]); });
    ro.observe(el); return () => ro.disconnect();
  }, [geo.data, cov.data]); // o SVG só existe depois que os dois carregam

  const byCode = useMemo(() => new Map((cov.data?.municipalities ?? []).map((m) => [m.ibge, m])), [cov.data]);
  const geoByCode = useMemo(() => new Map((geo.data?.municipalities ?? []).map((m) => [m.id, m])), [geo.data]);
  const statusOf = useCallback((id: string): Status => byCode.get(id)?.status ?? 'NENHUMA', [byCode]);

  // ---------- zoom (viewBox animado) ----------
  const full = geo.data?.viewBox ?? [0, 0, 1000, 1200];
  const target = useMemo<[number, number, number, number]>(() => {
    const st = geo.data?.states.find((s) => s.uf === uf);
    if (!st) return full as [number, number, number, number];
    const [x1, y1, x2, y2] = st.box; const pad = Math.max(x2 - x1, y2 - y1) * 0.06;
    return [x1 - pad, y1 - pad, x2 - x1 + pad * 2, y2 - y1 + pad * 2];
  }, [uf, geo.data, full]);
  const [vb, setVb] = useState<[number, number, number, number]>(full as [number, number, number, number]);
  const vbRef = useRef(vb); vbRef.current = vb;
  useEffect(() => {
    const from = vbRef.current; const t0 = performance.now(); let raf = 0;
    const step = (t: number): void => { const k = Math.min(1, (t - t0) / 350); const e = 1 - Math.pow(1 - k, 3); setVb(from.map((v, i) => v + (target[i]! - v) * e) as [number, number, number, number]); if (k < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step); return () => cancelAnimationFrame(raf);
  }, [target]);

  // ---------- busca ----------
  const results = useMemo(() => {
    const t = norm(q); if (t.length < 2 || !geo.data) return [];
    return geo.data.municipalities.filter((m) => norm(m.n).includes(t)).sort((a, b) => (norm(a.n).startsWith(t) ? 0 : 1) - (norm(b.n).startsWith(t) ? 0 : 1) || a.n.localeCompare(b.n, 'pt-BR')).slice(0, 8);
  }, [q, geo.data]);
  const pick = (id: string): void => { const m = geoByCode.get(id); setSelected(id); setQ(''); if (m && uf && m.uf !== uf) setUf(m.uf); };

  // ---------- lista ----------
  const list = useMemo(() => (cov.data?.municipalities ?? []).filter((m) => (m.status !== 'NENHUMA' || m.entities.length) && (!uf || m.uf === uf)).sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.name.localeCompare(b.name, 'pt-BR')), [cov.data, uf]);

  const fillOf = (m: GeoMun): string => {
    const s = statusOf(m.id);
    if (m.cap && !hidden.has('CAPITAL')) return 'var(--cov-capital)';
    if (hidden.has(s)) return 'var(--cov-nenhuma)';
    return STATUS[s].color;
  };
  const opacityOf = (m: GeoMun): number => {
    const s = statusOf(m.id); let o = 1;
    if (uf && m.uf !== uf) o = 0.3;
    if (hidden.has(s) && s !== 'NENHUMA' && !(m.cap && !hidden.has('CAPITAL'))) o *= 0.45;
    return o;
  };
  const toggle = (k: LegendKey): void => setHidden((h) => { const n = new Set(h); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  if (geo.isError) return <Empty>Não foi possível carregar o mapa.</Empty>;
  if (!geo.data || !cov.data) return <Skeleton className="h-[60vh]" />;
  const g = geo.data;
  const summaries = cov.data.summary.filter((s) => !uf || s.uf === uf);
  const tipMun = tip ? geoByCode.get(tip.id) : null;
  const sel = selected ? geoByCode.get(selected) : null;
  // tamanhos em pixels de tela, convertidos para unidades do viewBox (legíveis em qualquer zoom e largura)
  // o SVG mantém a proporção: vale a dimensão (largura ou altura) que limita o desenho
  const unit = Math.max(vb[2] / Math.max(px[0], 1), vb[3] / Math.max(px[1], 1));
  const fontSize = 12.5 * unit; const pinR = 5.5 * unit;

  return (
    <div className="space-y-3">
      <div className="filters" style={{ gap: 10 }}>
        <div className="seg" role="group" aria-label="Filtrar por estado">
          {[['', 'Todos'], ['MA', 'Maranhão'], ['PI', 'Piauí'], ['TO', 'Tocantins']].map(([k, l]) => <button key={k} className={uf === k ? 'on' : ''} onClick={() => setUf(k!)} aria-pressed={uf === k}>{l}</button>)}
        </div>
        <div className="cov-search" style={{ flex: '1 1 220px', maxWidth: 360 }}>
          <Input value={q} onChange={(e) => { setQ(e.target.value); setQIdx(0); }} placeholder="Buscar município…" aria-label="Buscar município"
            onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setQIdx((i) => Math.min(i + 1, results.length - 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setQIdx((i) => Math.max(i - 1, 0)); } else if (e.key === 'Enter' && results[qIdx]) pick(results[qIdx]!.id); else if (e.key === 'Escape') setQ(''); }} />
          {results.length > 0 && (
            <div className="sugg-list" role="listbox">
              {results.map((m, i) => <button key={m.id} role="option" aria-selected={i === qIdx} className={i === qIdx ? 'on' : ''} onClick={() => pick(m.id)}>{m.n} <span className="muted">/ {m.uf}{m.cap ? ' · capital' : ''} · {STATUS[statusOf(m.id)].label}</span></button>)}
            </div>
          )}
          {norm(q).length >= 2 && results.length === 0 && <div className="sugg-list"><div className="small muted" style={{ padding: '7px 10px' }}>Nenhum município encontrado</div></div>}
        </div>
        {cov.data.entitiesWithoutIbge > 0 && <span className="small muted">{cov.data.entitiesWithoutIbge} entidade(s) sem código IBGE não aparecem no mapa</span>}
      </div>
      {cov.data.ibgeMismatches.length > 0 && (
        <details className="small" style={{ color: 'var(--warn)' }}>
          <summary style={{ cursor: 'pointer' }}>⚠ {cov.data.ibgeMismatches.length} entidade(s) com código IBGE diferente do município cadastrado — confira o cadastro</summary>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18, color: 'var(--ink2)' }}>
            {cov.data.ibgeMismatches.map((m) => <li key={m.id}><Link href={`/financeiro/entidades/${m.id}`}>{m.name}</Link>: cadastrada em {m.municipality}/{m.uf}, mas o código {m.ibgeCode} é de {m.ibgeName ?? 'município fora do mapa'}</li>)}
          </ul>
        </details>
      )}

      <div className="cov-grid">
        <div className="card cov-map">
          <svg ref={svgRef} viewBox={vb.join(' ')} role="img" aria-label="Mapa de cobertura comercial de Maranhão, Piauí e Tocantins" onMouseLeave={() => setTip(null)}>
            {g.municipalities.map((m) => (
              <path key={m.id} className={`m${selected === m.id ? ' sel' : ''}`} d={m.d} fill={fillOf(m)} opacity={opacityOf(m)}
                onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, id: m.id })} onClick={() => setSelected(m.id)} />
            ))}
            {g.states.map((s) => <path key={s.uf} className="st" d={s.d} opacity={uf && s.uf !== uf ? 0.5 : 1} />)}
            {sel && <path className="m sel" d={sel.d} fill="none" style={{ pointerEvents: 'none' }} />}
            {g.municipalities.filter((m) => m.cap).map((m) => (
              <g key={`cap-${m.id}`} opacity={uf && m.uf !== uf ? 0.4 : 1}>
                <path className="pin" strokeWidth={unit * 1.2} d={`M${m.c[0]} ${m.c[1]} l${-pinR} ${-pinR * 1.6} a${pinR} ${pinR} 0 1 1 ${pinR * 2} 0 z`} />
                <circle cx={m.c[0]} cy={m.c[1] - pinR * 2.1} r={pinR * 0.4} fill="var(--cov-label-halo)" pointerEvents="none" />
                <text className="lbl" x={m.c[0] + pinR * 1.4} y={m.c[1] - pinR * 1.2} fontSize={fontSize} strokeWidth={fontSize * 0.28}>{m.n}</text>
              </g>
            ))}
          </svg>
          <div className="cov-legend" aria-label="Legenda (clique para ligar/desligar)">
            {ORDER.map((s) => <button key={s} className={hidden.has(s) ? 'off' : ''} onClick={() => toggle(s)} aria-pressed={!hidden.has(s)}><span className="cov-sw" style={{ background: STATUS[s].color }} />{STATUS[s].label}</button>)}
            <button className={hidden.has('CAPITAL') ? 'off' : ''} onClick={() => toggle('CAPITAL')} aria-pressed={!hidden.has('CAPITAL')}><span className="cov-sw" style={{ background: 'var(--cov-capital)' }} />Capital (ponto de saída)</button>
          </div>
        </div>

        <div className="space-y-3">
          {sel && <MunicipalityPanel key={sel.id} geo={sel} data={byCode.get(sel.id) ?? null} canWrite={can('crm.write')} onClose={() => setSelected(null)}
            onSaved={() => { void qc.invalidateQueries({ queryKey: ['coverage-map'] }); }} />}
          <div className="card"><div className="bd">
            <b className="small">Cobertura por estado</b>
            {summaries.map((s) => (
              <div key={s.uf} style={{ marginTop: 10 }}>
                <div className="row between small"><span><b>{UF_NAMES[s.uf]}</b> <span className="muted">· {s.total} municípios</span></span><b style={{ color: 'var(--cov-ativo)' }}>{s.atendidosPct.toLocaleString('pt-BR')}% atendidos</b></div>
                <div className="cov-bar" title={`Ativos ${s.ativo} · Implantação ${s.implantacao} · Negociação ${s.negociacao} · Livres ${s.livres}`}>
                  {(['ativo', 'implantacao', 'negociacao'] as const).map((k) => <span key={k} style={{ width: `${(s[k] / s.total) * 100}%`, background: STATUS[k.toUpperCase() as Status].color }} />)}
                </div>
                <div className="small muted">{s.ativo + s.implantacao} atendidos ({s.ativo} ativos · {s.implantacao} em implantação) · {s.negociacao} em negociação · {s.livres} livres</div>
              </div>
            ))}
          </div></div>
          <div className="card"><div className="bd">
            <b className="small">Municípios com atuação ({list.length})</b>
            {list.length === 0 ? <Empty>Nenhum município com atuação{uf ? ` em ${UF_NAMES[uf]}` : ''}</Empty> : (
              <div className="cov-list" style={{ marginTop: 6 }}>
                {list.map((m) => (
                  <button key={m.ibge} className={selected === m.ibge ? 'on' : ''} onClick={() => setSelected(m.ibge)}>
                    <span className="cov-sw" style={{ background: STATUS[m.status].color }} />
                    <span style={{ flex: 1, minWidth: 0 }}>{m.name}<span className="muted">/{m.uf}</span>{m.capital ? <span className="muted"> · capital</span> : null}</span>
                    <span className="small muted">{m.entities.length ? `${m.entities.length} ent.` : STATUS[m.status].label}</span>
                  </button>
                ))}
              </div>
            )}
          </div></div>
        </div>
      </div>

      {tip && tipMun && (
        <div className="cov-tip" style={{ left: Math.min(tip.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 250), top: tip.y + 14 }} role="tooltip">
          <b>{tipMun.n}</b> <span className="muted">/ {tipMun.uf}</span>{tipMun.cap ? <span style={{ color: 'var(--cov-capital)', fontWeight: 600 }}> · Capital</span> : null}
          <div className="row" style={{ gap: 6, marginTop: 3 }}><span className="cov-sw" style={{ background: STATUS[statusOf(tipMun.id)].color }} />{STATUS[statusOf(tipMun.id)].label}</div>
        </div>
      )}

    </div>
  );
}

function MunicipalityPanel({ geo, data, canWrite, onClose, onSaved }: { geo: GeoMun; data: CovMun | null; canWrite: boolean; onClose: () => void; onSaved: () => void }) {
  const status: Status = data?.status ?? 'NENHUMA';
  const [manual, setManual] = useState<Manual>(data?.manualStatus ?? 'NENHUMA');
  const [notes, setNotes] = useState(data?.notes ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [onClose]);
  const save = useMutation({
    mutationFn: () => api<CovMun>(`/comercial/mapa/${geo.id}`, { method: 'PUT', body: { status: manual, notes: notes.trim() || null } }),
    onSuccess: (r) => { setMsg(`Situação salva: ${STATUS[r.status].label}`); onSaved(); },
    onError: (e) => setMsg(e instanceof ApiError ? e.message : 'Falha ao salvar'),
  });
  const dirty = manual !== (data?.manualStatus ?? 'NENHUMA') || (notes.trim() || null) !== (data?.notes ?? null);
  return (
    <aside className="cov-panel" aria-label={`Município ${geo.n}`}>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div><h3>{geo.n}</h3><div className="small muted">{UF_NAMES[geo.uf]} ({geo.uf}){geo.cap ? ' · Capital (ponto de saída)' : ''}</div></div>
        <button className="btn sm" onClick={onClose} aria-label="Fechar painel">✕</button>
      </div>
      <dl>
        <dt>Código IBGE</dt><dd className="num">{geo.id}</dd>
        <dt>Situação</dt><dd><span className="row" style={{ gap: 6 }}><span className="cov-sw" style={{ background: STATUS[status].color }} /><b>{STATUS[status].label}</b></span>
          {status === 'ATIVO' && <div className="small muted">automática: há contrato ativo</div>}
          {status === 'IMPLANTACAO' && data?.hasActiveContract && <div className="small muted">contrato ativo em implantação</div>}</dd>
        {data?.updatedAt && <><dt>Atualizado</dt><dd className="small">{new Date(data.updatedAt).toLocaleString('pt-BR')}</dd></>}
      </dl>
      <div style={{ marginTop: 6 }}>
        <b className="small">Entidades atendidas</b>
        {data?.entities.length ? (
          <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {data.entities.map((e) => <li key={e.id}><Link href={`/financeiro/entidades/${e.id}`}>{e.shortName ?? e.name}</Link> <span className="muted">· {ENTITY_TYPE_LABELS[e.type as EntityType] ?? e.type}{e.activeContracts ? ` · ${e.activeContracts} contrato(s) ativo(s)` : ' · sem contrato ativo'}</span></li>)}
          </ul>
        ) : <div className="small muted">Nenhuma entidade cadastrada neste município.</div>}
      </div>
      <div style={{ marginTop: 10 }}>
        <b className="small">Módulos contratados</b>
        {data?.modules.length ? <div className="row" style={{ flexWrap: 'wrap', gap: 4, marginTop: 4 }}>{data.modules.map((m) => <span key={m} className="pill">{m}</span>)}</div> : <div className="small muted">{data?.hasActiveContract ? 'Contrato ativo sem módulos detalhados.' : 'Nenhum módulo contratado.'}</div>}
      </div>
      <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
        <b className="small">Situação comercial</b>
        {canWrite ? (
          <div className="space-y-2" style={{ marginTop: 6 }}>
            <Select value={manual} onChange={(e) => { setManual(e.target.value as Manual); setMsg(null); }} aria-label="Situação comercial">
              <option value="NENHUMA">{data?.hasActiveContract ? 'Automática (cliente ativo pelo contrato)' : 'Sem atuação'}</option>
              <option value="NEGOCIACAO">Em negociação</option>
              <option value="IMPLANTACAO">Em implantação</option>
            </Select>
            <Textarea rows={2} value={notes} onChange={(e) => { setNotes(e.target.value); setMsg(null); }} placeholder="Observação (opcional)" maxLength={1000} />
            <div className="row between"><span className="small muted">"Cliente ativo" é automático quando há contrato ativo.</span><Button size="sm" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar'}</Button></div>
            {msg && <div className="small" role="status">{msg}</div>}
          </div>
        ) : <div className="small muted">Sem permissão para alterar a situação.</div>}
      </div>
    </aside>
  );
}
