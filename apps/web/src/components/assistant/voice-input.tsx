'use client';
/**
 * Ditado por voz do Assistente (Fase 13).
 * - Com provedor de transcrição configurado (Integrações → Transcrição de fala): grava com MediaRecorder e envia
 *   para /api/assistente/transcrever (funciona em qualquer navegador moderno, inclusive iPhone).
 * - Sem provedor: usa o reconhecimento de voz do próprio navegador (Web Speech API, Chrome/Edge), sem custo.
 * O texto reconhecido vai para a caixa de mensagem para o usuário conferir antes de enviar.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

type SpeechRecognitionLike = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; abort: () => void; onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null };
type SRCtor = new () => SpeechRecognitionLike;

function browserRecognition(): SRCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type VoiceMode = 'server' | 'browser' | 'none';

export function useVoiceMode(serverAvailable: boolean | undefined): VoiceMode {
  const [mode, setMode] = useState<VoiceMode>('none');
  useEffect(() => {
    const hasMedia = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined';
    if (serverAvailable === undefined) setMode('none'); // aguarda o status do servidor para não trocar de modo depois de exibido
    else if (serverAvailable && hasMedia) setMode('server');
    else if (browserRecognition()) setMode('browser');
    else setMode('none');
  }, [serverAvailable]);
  return mode;
}

export function VoiceButton({ mode, disabled, onText, onInterim, onError, onStateChange }: { mode: VoiceMode; disabled?: boolean; onText: (text: string) => void; onInterim?: (text: string) => void; onError: (msg: string) => void; onStateChange?: (recording: boolean, transcribing: boolean) => void }) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const srRef = useRef<SpeechRecognitionLike | null>(null);
  const chunks = useRef<Blob[]>([]);
  const finalText = useRef('');

  useEffect(() => { onStateChange?.(recording, transcribing); }, [recording, transcribing, onStateChange]);
  useEffect(() => () => { recRef.current?.stream.getTracks().forEach((t) => t.stop()); srRef.current?.abort(); }, []);

  const stop = useCallback(() => {
    if (mode === 'server') { const r = recRef.current; if (r && r.state !== 'inactive') r.stop(); }
    else srRef.current?.stop();
  }, [mode]);

  const start = useCallback(async () => {
    if (mode === 'server') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
        const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        chunks.current = [];
        rec.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
        rec.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          setRecording(false);
          const blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' });
          if (blob.size < 1000) { onError('Gravação muito curta.'); return; }
          setTranscribing(true);
          try {
            const fd = new FormData();
            fd.append('audio', blob, `ditado.${(blob.type.split('/')[1] ?? 'webm').split(';')[0]}`);
            fd.append('prompt', 'Siow System: prefeitura, câmara municipal, contrato, nota fiscal, oportunidade, licitação, entidade, UF, município.');
            const r = await api<{ text: string }>('/assistente/transcrever', { method: 'POST', formData: fd });
            if (r.text) onText(r.text); else onError('Não entendi o áudio. Tente de novo falando mais perto do microfone.');
          } catch (e) { onError(e instanceof ApiError ? e.message : 'Falha na transcrição.'); }
          finally { setTranscribing(false); }
        };
        recRef.current = rec; rec.start(); setRecording(true);
        setTimeout(() => { if (rec.state === 'recording') rec.stop(); }, 120_000); // limite de 2 min por ditado
      } catch { onError('Não foi possível acessar o microfone. Verifique a permissão do navegador.'); }
      return;
    }
    const Ctor = browserRecognition(); if (!Ctor) { onError('Este navegador não tem reconhecimento de voz. Use Chrome/Edge ou configure a transcrição em Integrações.'); return; }
    const sr = new Ctor(); sr.lang = 'pt-BR'; sr.continuous = true; sr.interimResults = true; finalText.current = '';
    sr.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]!; const t = r[0]?.transcript ?? ''; if (r.isFinal) finalText.current += (finalText.current ? ' ' : '') + t.trim(); else interim += t; }
      onInterim?.((finalText.current + ' ' + interim).trim());
    };
    sr.onerror = (e) => { if (e.error !== 'aborted' && e.error !== 'no-speech') onError(e.error === 'not-allowed' ? 'Permissão de microfone negada.' : `Erro no reconhecimento de voz (${e.error}).`); };
    sr.onend = () => { setRecording(false); const t = finalText.current.trim(); if (t) onText(t); srRef.current = null; };
    srRef.current = sr; sr.start(); setRecording(true);
  }, [mode, onText, onInterim, onError]);

  if (mode === 'none') return null;
  const title = recording ? 'Parar gravação' : transcribing ? 'Transcrevendo…' : mode === 'server' ? 'Falar (transcrição pelo provedor configurado)' : 'Falar (reconhecimento do navegador)';
  return (
    <button type="button" className={`btn${recording ? ' danger' : ''}`} onClick={() => (recording ? stop() : void start())} disabled={disabled || transcribing} title={title} aria-pressed={recording} aria-label={title}>
      {recording ? <Square className="h-4 w-4" /> : <Mic className={`h-4 w-4${transcribing ? ' animate-pulse' : ''}`} />}
    </button>
  );
}

/** Lê um texto em voz alta com a síntese do navegador (pt-BR), se disponível. */
export function speak(text: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[*_`#>]/g, '').slice(0, 1500));
    u.lang = 'pt-BR';
    const voice = window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith('pt-br')) ?? window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith('pt'));
    if (voice) u.voice = voice;
    window.speechSynthesis.speak(u);
  } catch { /* síntese indisponível */ }
}
export function stopSpeaking(): void { if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel(); }
export function canSpeak(): boolean { return typeof window !== 'undefined' && 'speechSynthesis' in window; }
