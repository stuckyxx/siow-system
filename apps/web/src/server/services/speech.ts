/**
 * Transcrição de fala (Fase 13): áudio → texto por um provedor compatível com a API Whisper
 * (OpenAI, Groq e similares), configurado em Administração → Integrações → "Transcrição de fala".
 * Usado pelo ditado por voz do Assistente e pela transcrição dos áudios recebidos no WhatsApp.
 */
import { HttpError, badRequest } from '../http.js';
import { call, resolve } from './integrations.js';

export const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
export const AUDIO_MIME = /^audio\/|^video\/(webm|mp4|ogg)/;

export async function capabilities(): Promise<{ server: boolean; provider: string | null; model: string | null }> {
  const cfg = await resolve('SPEECH').catch(() => null);
  const ok = Boolean(cfg && cfg.enabled && cfg.configured && !cfg.circuitOpen);
  return { server: ok, provider: ok ? cfg!.provider : null, model: ok ? cfg!.config['model'] || 'whisper-1' : null };
}

export interface Transcript { text: string; language: string | null; durationSec: number | null; provider: string; model: string }

/** Transcreve um áudio (pt-BR por padrão). Lança 400 se a integração não estiver configurada. */
export async function transcribe(input: { buffer: Buffer; mimeType: string; fileName?: string; language?: string; prompt?: string; referenceType?: string; referenceId?: string }): Promise<Transcript> {
  const cfg = await resolve('SPEECH');
  if (!cfg.enabled || !cfg.configured) throw badRequest('Transcrição de fala não configurada (Administração → Integrações → Transcrição de fala)');
  if (cfg.circuitOpen) throw badRequest('Provedor de transcrição com falhas seguidas: circuito aberto por 15 minutos');
  if (input.buffer.length === 0) throw badRequest('Áudio vazio');
  if (input.buffer.length > MAX_AUDIO_BYTES) throw badRequest('Áudio acima de 15 MB');
  const apiUrl = (cfg.config['apiUrl'] || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = cfg.config['model'] || 'whisper-1';
  const ext = (input.mimeType.split('/')[1] ?? 'webm').split(';')[0]!.replace('mpeg', 'mp3').replace('x-m4a', 'm4a');
  const fileName = input.fileName ?? `audio.${ext}`;
  try {
  return await call<Transcript>('SPEECH', 'TRANSCRIBE', { request: { bytes: input.buffer.length, mimeType: input.mimeType, model }, referenceType: input.referenceType, referenceId: input.referenceId }, async () => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(input.buffer)], { type: input.mimeType.split(';')[0] }), fileName);
    form.append('model', model);
    form.append('language', input.language ?? 'pt');
    form.append('response_format', 'verbose_json');
    if (input.prompt) form.append('prompt', input.prompt.slice(0, 500));
    const res = await fetch(`${apiUrl}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${cfg.config['apiKey']}` }, body: form, signal: AbortSignal.timeout(90_000) });
    const json = (await res.json().catch(() => null)) as { text?: string; language?: string; duration?: number; error?: { message?: string } } | null;
    if (!res.ok || !json || typeof json.text !== 'string') throw new Error(json?.error?.message ?? `Provedor respondeu HTTP ${res.status}`);
    const result: Transcript = { text: json.text.trim(), language: json.language ?? null, durationSec: typeof json.duration === 'number' ? json.duration : null, provider: cfg.provider, model };
    return { result, response: { chars: result.text.length, language: result.language, duration: result.durationSec }, ok: true };
  });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, `Transcrição falhou no provedor: ${e instanceof Error ? e.message : String(e)}`);
  }
}
