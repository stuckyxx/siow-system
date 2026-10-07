'use client';
import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { formatBRL, formatBrDate, type DashboardResponse, type EntitySummary, type InvoiceRow, type Paginated } from '@siow/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

type Msg = { kind: 'u' | 'a'; text: string };

const CHIPS = ['quem está devendo', 'maiores devedores', 'contratos vencendo', 'certidões vencendo', 'relatório de inadimplentes', 'só câmaras'];
const HELP = 'Exemplos: "quem está devendo", "maiores devedores", "notas pendentes de Pedreiras", "abrir Bom Lugar", "nota 50493", "contratos vencendo", "relatório de inadimplentes", "sincronizar Araioses".';

const norm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * "Busca rápida" — botão flutuante que interpreta o texto por REGRAS (não usa IA)
 * e aplica filtros / abre a tela certa. Nunca envia mensagens nem altera status:
 * só navega ou dispara a sincronização (que exige a permissão sync.run).
 */
export function QuickSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([{ kind: 'a', text: 'Digite o que procura e eu aplico o filtro ou abro a tela certa. ' + HELP }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const { data: entities } = useQuery({
    queryKey: ['qs-entities'],
    queryFn: () => api<Paginated<EntitySummary>>('/financeiro/entities', { query: { pageSize: 200, sortBy: 'name', sortDir: 'asc' } }),
    enabled: open && can('entities.read'),
    staleTime: 5 * 60_000,
  });

  useEffect(() => { box.current?.scrollTo(0, box.current.scrollHeight); }, [msgs]);
  if (pathname === '/login') return null;

  const findEntity = (t: string): { pick: EntitySummary | null; many: EntitySummary[] } => {
    const list = entities?.items ?? [];
    const wantType = /\bpm\b|prefeitura/.test(t) ? 'PM' : /\bcm\b|camara/.test(t) ? 'CM' : null;
    const cands = list.filter((e) => t.includes(norm(e.municipality)) || (e.shortName && t.includes(norm(e.shortName))));
    const pick = cands.find((e) => !wantType || e.type === wantType) ?? cands[0] ?? null;
    return { pick, many: wantType ? [] : cands };
  };

  async function answer(q: string): Promise<string> {
    const t = norm(q);
    const { pick, many } = findEntity(t);
    if (many.length > 1 && !/relat/.test(t)) return `Existem ${many.length} entidades em ${many[0]!.municipality}: ${many.map((e) => e.shortName ?? e.name).join(' e ')}. Diga qual (ex.: "${t.includes('pm') ? '' : 'pm '}${norm(many[0]!.municipality)}").`;

    if (/limpar|sem filtro/.test(t)) { router.push('/financeiro'); return 'Filtros limpos — abrindo o dashboard.'; }
    if (/sincroniz/.test(t)) {
      if (!can('sync.run')) return 'Você não tem permissão para sincronizar.';
      if (pick) { await api(`/financeiro/sync/entities/${pick.id}`, { method: 'POST' }); return `Sincronização de ${pick.shortName ?? pick.name} enfileirada.`; }
      router.push('/financeiro/sincronizacao'); return 'Abrindo o painel de sincronização (use "Sincronizar todas").';
    }
    if (/relat/.test(t)) {
      const key = /inadimpl/.test(t) ? 'defaulters' : /receb|pagament/.test(t) ? 'payments' : /prevista|previsao|receita/.test(t) ? 'forecast' : /nota/.test(t) ? 'invoices' : /contrat/.test(t) ? 'contracts' : /certid/.test(t) ? 'certificates' : /ordem|\bos\b/.test(t) ? 'service_orders' : /agenda|taref/.test(t) ? 'tasks' : /cobran/.test(t) ? 'collections' : /medio|tempo/.test(t) ? 'average_days_to_pay' : 'financial_overview';
      const year = t.match(/20\d\d/)?.[0];
      const qs = new URLSearchParams({ r: key, ...(pick ? { entityId: pick.id } : {}), ...(year ? { year } : {}) });
      router.push(`/financeiro/relatorios?${qs.toString()}`);
      return `Abrindo a pré-visualização do relatório${pick ? ` de ${pick.shortName ?? pick.name}` : ''}${year ? ` (${year})` : ''}.`;
    }
    if (/contrat/.test(t) && /venc|expir|termin/.test(t)) {
      const l = await api<Array<{ number: string; endDate: string | null; entity?: { shortName: string | null; name: string } }>>('/financeiro/contracts', { query: { expiringDays: 120 } });
      return l.length ? 'Contratos vencendo em até 120 dias:\n' + l.map((c) => `• ${c.entity?.shortName ?? c.entity?.name} — ${c.number} até ${formatBrDate(c.endDate)}`).join('\n') : 'Nenhum contrato vence nos próximos 120 dias.';
    }
    if (/certid/.test(t)) { router.push('/financeiro/certidoes'); return 'Abrindo Certidões (vencendo e vencidas aparecem destacadas).'; }
    if (/^(pm|cm|prefeitura|camara)s?\b/.test(t) || /(so|somente|apenas|filtrar) (pm|cm|prefeitura|camara)s?/.test(t)) {
      const type = /\bcm\b|camara/.test(t) ? 'CM' : 'PM';
      router.push(`/financeiro/entidades?type=${type}`);
      return `Mostrando somente ${type === 'CM' ? 'câmaras' : 'prefeituras'}.`;
    }
    const num = t.match(/\b\d{4,}\b/)?.[0];
    if (num && /nota|nf|^\d+$/.test(t) && can('invoices.read')) {
      const r = await api<Paginated<InvoiceRow>>('/financeiro/invoices', { query: { q: num, pageSize: 5 } });
      const i = r.items.find((x) => x.number === num) ?? r.items[0];
      if (!i) return `Nota ${num} não encontrada.`;
      router.push(`/financeiro/entidades/${i.entityId}?tab=invoices&nota=${i.id}`);
      return `Nota ${i.number} — ${i.entityName}, competência ${String(i.competenceMonth).padStart(2, '0')}/${i.competenceYear}, ${formatBRL(i.amount)}, ${i.status === 'PAID' ? `paga em ${formatBrDate(i.paidAt)}` : 'pendente'}.`;
    }
    if (pick && /nota|pendent|debito|devendo/.test(t)) {
      router.push(`/financeiro/entidades/${pick.id}?tab=invoices`);
      return `${pick.shortName ?? pick.name}: ${pick.pendingInvoices} nota(s) pendente(s), ${formatBRL(pick.debtTotal)} em débito. Abrindo as notas fiscais.`;
    }
    if (/maior|top|mais dev/.test(t) || /devendo|inadimpl|debito|quem deve|pendente/.test(t)) {
      const d = await api<DashboardResponse>('/financeiro/dashboard');
      const top = d.topDebtors.slice(0, /maior|top|mais/.test(t) ? 5 : 15);
      router.push('/financeiro');
      return top.length ? `${d.topDebtors.length} entidade(s) com débito:\n` + top.map((x) => `• ${x.entityName} — ${formatBRL(x.debt)} (${x.pendingInvoices} nota(s))`).join('\n') : 'Nenhuma entidade com débito no momento.';
    }
    if (pick) {
      const tab = /contrat/.test(t) ? 'contracts' : /agenda|tarefa/.test(t) ? 'agenda' : /ordem|\bos\b/.test(t) ? 'orders' : /contato/.test(t) ? 'contacts' : 'overview';
      router.push(`/financeiro/entidades/${pick.id}?tab=${tab}`);
      return `Abrindo ${pick.shortName ?? pick.name}: ${formatBRL(pick.debtTotal)} em débito, ${pick.pendingInvoices} nota(s) pendente(s).`;
    }
    return 'Não encontrei. ' + HELP;
  }

  async function send(text?: string): Promise<void> {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setInput('');
    setMsgs((m) => [...m, { kind: 'u', text: q }]);
    setBusy(true);
    try {
      const r = await answer(q);
      setMsgs((m) => [...m, { kind: 'a', text: r }]);
    } catch {
      setMsgs((m) => [...m, { kind: 'a', text: 'Não consegui consultar agora. Tente novamente.' }]);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="fab" onClick={() => setOpen(true)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
        Busca rápida
      </button>
    );
  }
  return (
    <div className="asst" role="dialog" aria-label="Busca rápida">
      <div className="ah">
        <div><b>Busca rápida</b><div className="small muted">filtro inteligente · sem IA</div></div>
        <div className="row">
          <button className="btn sm" onClick={() => setMsgs([{ kind: 'a', text: HELP }])}>Limpar</button>
          <button className="btn sm" onClick={() => setOpen(false)} aria-label="Fechar">✕</button>
        </div>
      </div>
      <div className="msgs" ref={box}>{msgs.map((m, i) => <div key={i} className={`m ${m.kind}`}>{m.text}</div>)}</div>
      <div className="chips">{CHIPS.map((c) => <button key={c} onClick={() => void send(c)}>{c}</button>)}</div>
      <form className="in" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="O que você procura?" autoFocus />
        <button className="btn p" type="submit" disabled={busy}>Ir</button>
      </form>
    </div>
  );
}
