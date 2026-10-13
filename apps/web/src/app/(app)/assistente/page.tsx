'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bot, CheckCircle2, Loader2, Send, ShieldAlert, XCircle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Card, Textarea } from '@/components/ui';

interface Step { tool: string; method?: string; path?: string; status?: number; ok: boolean; summary: string; pending?: Pending }
interface Pending { token: string; method: string; path: string; body?: unknown; reason: string }
interface Turn { role: 'user' | 'assistant'; content: string; steps?: Step[]; pending?: Pending[]; error?: boolean }
interface Result { reply: string; steps: Step[]; pending: Pending[]; stopReason: string | null }

const SUGGESTIONS = [
  'Cadastre a Prefeitura Municipal de Tuntum (MA)',
  'Crie um contrato nº 012/2026 de R$ 4.500,00 mensais para a Câmara de Bom Lugar, vigência de hoje até 31/12/2026',
  'Crie uma nova oportunidade de lead para a Prefeitura de Bacabal com valor mensal de R$ 3.000',
  'Quais notas estão pendentes este mês? Resuma por entidade',
  'Abra uma tarefa para amanhã: ligar para o secretário de finanças de Tuntum',
];

export default function AssistantPage() {
  const { user } = useAuth();
  const status = useQuery({ queryKey: ['assistant', 'status'], queryFn: () => api<{ configured: boolean; model: string }>('/assistente') });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [turns, busy]);

  async function send(text: string, approvals?: Pending[]) {
    const content = text.trim();
    if ((!content && !approvals?.length) || busy) return;
    const userTurn: Turn = { role: 'user', content: content || `Confirmo: ${approvals!.map((a) => a.reason.toLowerCase()).join(', ')}.` };
    const history = [...turns.filter((t) => !t.error), userTurn].map((t) => ({ role: t.role, content: t.content }));
    setTurns((t) => [...t, userTurn]);
    setInput('');
    setBusy(true);
    try {
      const r = await api<Result>('/assistente', { method: 'POST', body: { messages: history.slice(-40), approvals } });
      setTurns((t) => [...t, { role: 'assistant', content: r.reply, steps: r.steps, pending: r.pending }]);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Falha ao falar com o assistente. Tente novamente.';
      setTurns((t) => [...t, { role: 'assistant', content: msg, error: true }]);
    } finally { setBusy(false); }
  }

  const lastPending = [...turns].reverse().find((t) => t.pending?.length)?.pending ?? [];
  const pendingResolved = turns.length && turns[turns.length - 1]!.role === 'user';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-xl font-semibold"><Bot className="h-6 w-6" strokeWidth={1.8} /> Assistente Siow</h1>
        <div className="text-xs text-ink-3">{status.data ? (status.data.configured ? `Operando como ${user?.name ?? 'você'} · ${status.data.model}` : 'Não configurado') : ''}</div>
      </div>
      {status.data && !status.data.configured && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"><ShieldAlert className="h-4 w-4 shrink-0" /> O assistente ainda não está ativo nesta instalação: o administrador precisa definir a variável de ambiente <code>ANTHROPIC_API_KEY</code>.</div>
      )}
      <p className="text-sm text-ink-2">Peça em linguagem natural e o assistente executa no sistema: cadastrar entidades, contratos, oportunidades, tarefas, chamados, licitações, consultar notas e relatórios. Ele usa as suas permissões e pede confirmação antes de ações sensíveis (exclusões, baixas de notas, envios de mensagens).</p>

      <Card className="flex min-h-[55vh] flex-col">
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {turns.length === 0 && (
            <div className="space-y-2">
              <div className="text-sm text-ink-3">Exemplos do que você pode pedir:</div>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => <button key={s} type="button" className="btn sm" onClick={() => void send(s)} disabled={busy || status.data?.configured === false}>{s}</button>)}
              </div>
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} className={`flex ${t.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${t.role === 'user' ? 'bg-brand text-white' : t.error ? 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200' : 'bg-surface-2'}`}>
                <div className="whitespace-pre-wrap break-words">{t.content}</div>
                {t.steps && t.steps.length > 0 && (
                  <details className="mt-2 text-xs opacity-80">
                    <summary className="cursor-pointer">Ações executadas ({t.steps.length})</summary>
                    <ul className="mt-1 space-y-1">
                      {t.steps.map((s, j) => (
                        <li key={j} className="flex items-start gap-1">
                          {s.pending ? <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" /> : s.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-600" />}
                          <span><span className="font-mono">{s.method} {s.path?.split('?')[0]}</span>{s.status ? ` · ${s.status}` : ''} — {s.summary}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {t.pending && t.pending.length > 0 && i === turns.length - 1 && !pendingResolved && (
                  <div className="mt-3 space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
                    <div className="flex items-center gap-1 font-medium"><ShieldAlert className="h-4 w-4" /> Confirmação necessária</div>
                    <ul className="list-disc space-y-1 pl-5">
                      {t.pending.map((p) => <li key={p.token}>{p.reason}: <span className="font-mono text-xs">{p.method} {p.path.split('?')[0]}</span>{p.body ? <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-white/60 p-2 text-[11px] dark:bg-black/30">{JSON.stringify(p.body, null, 1)}</pre> : null}</li>)}
                    </ul>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => void send('', t.pending)} disabled={busy}>Confirmar e executar</Button>
                      <Button size="sm" variant="secondary" onClick={() => void send('Não confirmo. Cancele essa ação.')} disabled={busy}>Cancelar</Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
          {busy && <div className="flex items-center gap-2 text-sm text-ink-3"><Loader2 className="h-4 w-4 animate-spin" /> O assistente está trabalhando…</div>}
          <div ref={endRef} />
        </div>
        <form className="flex items-end gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); } }}
            placeholder={lastPending.length && !pendingResolved ? 'Confirme ou cancele a ação acima, ou escreva outra instrução…' : 'Ex.: cadastre a Câmara Municipal de Pedreiras (MA) e crie uma oportunidade de R$ 2.500/mês'}
            rows={2}
            className="flex-1"
            disabled={busy || status.data?.configured === false}
          />
          <Button type="submit" disabled={busy || !input.trim() || status.data?.configured === false} title="Enviar (Enter)"><Send className="h-4 w-4" /></Button>
        </form>
      </Card>
      {turns.length > 0 && <div className="text-right"><button type="button" className="btn sm" onClick={() => setTurns([])} disabled={busy}>Nova conversa</button></div>}
    </div>
  );
}
