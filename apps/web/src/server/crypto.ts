/**
 * Cifra segredos de integrações em repouso (AES-256-GCM). Chave derivada de INTEGRATION_SECRET_KEY
 * (ou, na falta, de JWT_ACCESS_SECRET). Formato: "v1:<iv b64>:<tag b64>:<cipher b64>".
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from './env.js';

function key(): Buffer { return createHash('sha256').update(process.env['INTEGRATION_SECRET_KEY'] ?? env().JWT_ACCESS_SECRET).digest(); }

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}
export function decryptSecret(value: string): string {
  if (!value.startsWith('v1:')) return value;
  const [, iv, tag, data] = value.split(':');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv!, 'base64'));
  d.setAuthTag(Buffer.from(tag!, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data!, 'base64')), d.final()]).toString('utf8');
}
/** Máscara para exibição: só os 4 últimos caracteres. */
export function maskSecret(plain: string | null | undefined): string | null { return plain ? `••••${plain.slice(-4)}` : null; }
