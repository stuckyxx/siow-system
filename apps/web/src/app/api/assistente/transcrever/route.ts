/** POST /api/assistente/transcrever — áudio (multipart "audio") → texto, pelo provedor de transcrição configurado. */
import { HttpError, route } from '@/server/http';
import { rateLimit } from '@/server/rate-limit';
import { AUDIO_MIME, MAX_AUDIO_BYTES, transcribe } from '@/server/services/speech';
import { audit } from '@/server/audit';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

export const POST = route([], async (ctx) => {
  await rateLimit(`assistant-stt:${ctx.user.id}`, { limit: 120, windowMs: 60 * 60 * 1000 });
  const form = await ctx.req.formData().catch(() => { throw new HttpError(400, 'Envie o áudio como multipart/form-data (campo "audio")'); });
  const file = form.get('audio');
  if (!(file instanceof File)) throw new HttpError(400, 'Campo "audio" ausente');
  if (file.size > MAX_AUDIO_BYTES) throw new HttpError(413, 'Áudio acima de 15 MB');
  const mimeType = file.type || 'audio/webm';
  if (!AUDIO_MIME.test(mimeType)) throw new HttpError(415, `Formato não suportado: ${mimeType}`);
  const prompt = typeof form.get('prompt') === 'string' ? String(form.get('prompt')) : undefined;
  const t = await transcribe({ buffer: Buffer.from(await file.arrayBuffer()), mimeType, fileName: file.name || undefined, prompt, referenceType: 'assistant', referenceId: ctx.user.id });
  await audit(ctx, { action: 'assistant.transcribe', resource: 'assistant', after: { chars: t.text.length, durationSec: t.durationSec, provider: t.provider } }).catch(() => undefined);
  return t;
});
