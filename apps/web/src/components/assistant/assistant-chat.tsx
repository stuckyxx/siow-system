'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, CheckCircle2, History, Loader2, Send, ShieldAlert, Trash2, Volume2, VolumeX, XCircle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Card, Dialog, Textarea } from '@/components/ui';
import { VoiceButton, canSpeak, speak, stopSpeaking, useVoiceMode } from '@/components/assistant/voice-input';

interface Step { tool: string; method?: string; path?: string; status?: number; ok: boolean; summary: string; pending?: Pending }
interface Pending { token: string; method: string; path: string; body?: unknown; reason: string }
interface Turn { role: 'user' | 'assistant'; content: string; steps?: Step[]; pending?: Pending[]; error?: boolean }
interface Result { reply: string; steps: Step[]; pending: Pending[]; stopReason: string | null; conversationId?: string }
interface Status { configured: boolean; model: string; speech: { server: boolean; provider: string | null } }
interface ConversationRow { id: string; title: string; messageCount: number; updatedAt: string }
interface ConversationFull extends ConversationRow { messages: Array<{ role: 'user' | 'assistant'; content: string; steps?: Step[]; pending?: Pending[]; at: string }> }

const DEFAULT_SUGGESTIONS = [
  'Cadastre a Prefeitura Municipal de Tuntum (MA)',
  'Crie um contrato nº 012/2026 de R$ 4.500,00 mensais para a Câmara de Bom Lugar, vigência de hoje até 31/12/2026',
  'Crie uma nova oportunidade de lead para a Prefeitura de Bacabal com valor mensal de R$ 3.000',
  'Quais notas estão pendentes este mês? Resuma por entidade',
  'Abra uma tarefa para amanhã: ligar para o secretário de finanças de Tuntum',
];

export interface AssistantContext { kind: 'entity' | 'contract' | 'opportunity' | 'ticket' | 'whatsapp' | 'tender'; id: string; label: string; path?: string }

/**
 * Chat do Assistente. Usado na página /assistente (modo completo) e, com `context`, dentro das telas
 * (entidade, contrato, oportunidade, chamado, conversa do WhatsApp): o registro aberto vira contexto do agente.
 */
export function AssistantChat({ context, suggestions, compact, onDone }: { context?: AssistantContext; suggestions?: string[]; compact?: boolean; onDone?: () => void } = {}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['assistant', 'status'], queryFn: () => api<Status>('/assistente') });
  const conversations = useQuery({ queryKey: ['assistant', 'conversations'], queryFn: () => api<ConversationRow[]>('/assistente/conversas') });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [voiceState, setVoiceState] = useState({ recording: false, transcribing: false });
  const [lastInputVoice, setLastInputVoice] = useState(false);
  const [readAloud, setReadAloud] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const voiceMode = useVoiceMode(status.data?.speech?.server);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [turns, busy]);
  useEffect(() => { try { setReadAloud(localStorage.getItem('siow.assistant.readAloud') === '1'); } catch { /* ignore */ } }, []);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 6000); return () => clearTimeout(t); }, [notice]);
  const onVoiceState = useCallback((recording: boolean, transcribing: boolean) => setVoiceState({ recording, transcribing }), []);
  const onVoiceText = useCallback((text: string) => { setInput((v) => (v.trim() ? v.trimEnd() + ' ' + text : text)); setLastInputVoice(true); }, []);
  const onVoiceInterim = useCallback((text: string) => setInput(text), []);
  const onVoiceError = useCallback((msg: string) => setNotice(msg), []);
  function toggleReadAloud() { const next = !readAloud; setReadAloud(next); if (!next) stopSpeaking(); try { localStorage.setItem('siow.assistant.readAloud', next ? '1' : '0'); } catch { /* ignore */ } }
  async function openConversation(id: string) {
    try { const c = await api<ConversationFull>(`/assistente/conversas/${id}`); setTurns(c.messages.map((m) => ({ role: m.role, content: m.content, steps: m.steps, pending: m.pending }))); setConversationId(c.id); setShowHistory(false); }
    catch (e) { setNotice(e instanceof ApiError ? e.message : 'Não foi possível abrir a conversa.'); }
  }
  async function removeConversation(id: string) {
    if (!confirm('Excluir esta conversa do histórico?')) return;
    try { await api(`/assistente/conversas/${id}`, { method: 'DELETE' }); if (conversationId === id) { setTurns([]); setConversationId(null); } void qc.invalidateQueries({ queryKey: ['assistant', 'conversations'] }); }
    catch (e) { setNotice(e instanceof ApiError ? e.message : 'Não foi possível excluir.'); }
  }
  function newConversation() { stopSpeaking(); setTurns([]); setConversationId(null); setInput(''); }

  async function send(text: string, approvals?: Pending[]) {
    const content = text.trim();
    if ((!content && !approvals?.length) || busy) return;
    const userTurn: Turn = { role: 'user', content: content || `Confirmo: ${approvals!.map((a) => a.reason.toLowerCase()).join(', ')}.` };
    const history = [...turns.filter((t) => !t.error), userTurn].map((t) => ({ role: t.role, content: t.content }));
    const inputMode = lastInputVoice && content ? 'voice' : 'text';
    setLastInputVoice(false);
    setTurns((t) => [...t, userTurn]);
    setInput('');
    setBusy(true);
    try {
      const r = await api<Result>('/assistente', { method: 'POST', body: { messages: history.slice(-40), approvals, conversationId, inputMode, context } });
      setTurns((t) => [...t, { role: 'assistant', content: r.reply, steps: r.steps, pending: r.pending }]);
      if (r.conversationId) { setConversationId(r.conversationId); void qc.invalidateQueries({ queryKey: ['assistant', 'conversations'] }); }
      if (readAloud) speak(r.reply);
      if (r.steps.some((s) => s.ok && s.method && s.method !== 'GET')) onDone?.();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Falha ao falar com o assistente. Tente novamente.';
      setTurns((t) => [...t, { role: 'assistant', content: msg, error: true }]);
    } finally { setBusy(false); }
  }

  const lastPending = [...turns].reverse().find((t) => t.pending?.length)?.pending ?? [];
  const pendingResolved = turns.length && turns[turns.length - 1]!.role === 'user';

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {compact ? <div className="flex items-center gap-2 text-sm text-ink-2"><Bot className="h-5 w-5" strokeWidth={1.8} /> {context ? <span>Contexto: <strong>{context.label}</strong></span> : 'Assistente Siow'}</div> : <h1 className="flex items-center gap-2 text-xl font-semibold"><Bot className="h-6 w-6" strokeWidth={1.8} /> Assistente Siow</h1>}
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-xs text-ink-3">{status.data ? (status.data.configured ? `Operando como ${user?.name ?? 'você'} · ${status.data.model}` : 'Não configurado') : ''}</div>
          {canSpeak() && <button type="button" className={`btn sm${readAloud ? ' on' : ''}`} onClick={toggleReadAloud} title={readAloud ? 'Parar de ler as respostas em voz alta' : 'Ler as respostas em voz alta'} aria-pressed={readAloud}>{readAloud ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />} {readAloud ? 'Lendo respostas' : 'Ler respostas'}</button>}
          <button type="button" className="btn sm" onClick={() => setShowHistory((v) => !v)} title="Conversas anteriores" aria-expanded={showHistory}><History className="h-4 w-4" /> Histórico{conversations.data?.length ? ` (${conversations.data.length})` : ''}</button>
        </div>
      </div>
      {notice && <div className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100" role="status"><ShieldAlert className="h-4 w-4 shrink-0" /> {notice}</div>}
      {showHistory && (
        <Card className="p-3">
          <div className="mb-2 flex items-center justify-between"><div className="text-sm font-medium">Conversas anteriores</div><button type="button" className="btn sm" onClick={newConversation}>Nova conversa</button></div>
          {!conversations.data ? <div className="text-sm text-ink-3">Carregando…</div> : conversations.data.length === 0 ? <div className="text-sm text-ink-3">Nenhuma conversa salva ainda.</div> : (
            <ul className="divide-y divide-line">
              {conversations.data.map((c) => (
                <li key={c.id} className={`flex items-center gap-2 py-2 text-sm ${c.id === conversationId ? 'font-medium' : ''}`}>
                  <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => void openConversation(c.id)} title={c.title}>{c.title}</button>
                  <span className="shrink-0 text-xs text-ink-3">{new Date(c.updatedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · {c.messageCount} msgs</span>
                  <button type="button" className="btn sm" onClick={() => void removeConversation(c.id)} title="Excluir conversa" aria-label="Excluir conversa"><Trash2 className="h-3.5 w-3.5" /></button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {status.data && !status.data.configured && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"><ShieldAlert className="h-4 w-4 shrink-0" /> O assistente ainda não está ativo nesta instalação: o administrador precisa definir a variável de ambiente <code>ANTHROPIC_API_KEY</code>.</div>
      )}
      {!compact && <p className="text-sm text-ink-2">Peça em linguagem natural, digitando ou <strong>falando</strong> (botão do microfone), e o assistente executa no sistema: cadastrar entidades, contratos, oportunidades, tarefas, chamados, licitações, consultar notas e relatórios. Ele usa as suas permissões e pede confirmação antes de ações sensíveis (exclusões, baixas de notas, envios de mensagens).{voiceMode === 'browser' ? ' O ditado usa o reconhecimento de voz do navegador.' : voiceMode === 'none' ? ' Para ditar por voz, use Chrome/Edge ou peça ao administrador para configurar a transcrição em Integrações.' : ''}</p>}

      <Card className={`flex flex-col ${compact ? 'min-h-[50vh] max-h-[70vh]' : 'min-h-[55vh]'}`}>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {turns.length === 0 && (
            <div className="space-y-2">
              <div className="text-sm text-ink-3">{context ? `O que fazer com ${context.label}?` : 'Exemplos do que você pode pedir:'}</div>
              <div className="flex flex-wrap gap-2">
                {(suggestions ?? DEFAULT_SUGGESTIONS).map((s) => <button key={s} type="button" className="btn sm" style={{ whiteSpace: 'normal', textAlign: 'left' }} onClick={() => void send(s)} disabled={busy || status.data?.configured === false}>{s}</button>)}
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
        <form className={`flex items-end gap-2 border-t border-line p-3 ${compact ? '' : 'pb-16 sm:pb-3'}`} onSubmit={(e) => { e.preventDefault(); void send(input); }}>
          <VoiceButton mode={voiceMode} disabled={busy || status.data?.configured === false} onText={onVoiceText} onInterim={voiceMode === 'browser' ? onVoiceInterim : undefined} onError={onVoiceError} onStateChange={onVoiceState} />
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); } }}
            placeholder={voiceState.recording ? 'Ouvindo… fale o seu pedido e toque em parar.' : voiceState.transcribing ? 'Transcrevendo o áudio…' : lastPending.length && !pendingResolved ? 'Confirme ou cancele a ação acima, ou escreva outra instrução…' : context ? `Ex.: resuma a situação, crie uma tarefa, registre uma interação…` : 'Ex.: cadastre a Câmara Municipal de Pedreiras (MA) e crie uma oportunidade de R$ 2.500/mês'}
            rows={2}
            className="flex-1"
            disabled={busy || status.data?.configured === false}
          />
          <Button type="submit" disabled={busy || !input.trim() || status.data?.configured === false} title="Enviar (Enter)"><Send className="h-4 w-4" /></Button>
        </form>
      </Card>
      {turns.length > 0 && <div className="text-right"><button type="button" className="btn sm" onClick={newConversation} disabled={busy}>Nova conversa</button></div>}
    </div>
  );
}

/** Botão "Pedir ao assistente" para telas de registro: abre o chat em um diálogo com o registro como contexto. */
export function AskAssistantButton({ context, suggestions, onChanged, size = 'sm', label = 'Pedir ao assistente' }: { context: AssistantContext; suggestions?: string[]; onChanged?: () => void; size?: 'sm' | 'md'; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`btn${size === 'sm' ? ' sm' : ''}`} onClick={() => setOpen(true)} title={`Assistente com contexto: ${context.label}`}><Bot className="h-4 w-4" /> {label}</button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Assistente · ${context.label}`} wide>
        <AssistantChat context={context} suggestions={suggestions} compact onDone={onChanged} />
      </Dialog>
    </>
  );
}
