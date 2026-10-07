/**
 * Armazenamento de arquivos — adaptador duplo:
 *  - Netlify (process.env.NETLIFY): Netlify Blobs, privado; o download passa pela rota
 *    autenticada /api/documents/[id]/download (storageKey = "netlify:<chave>").
 *  - Vercel: Vercel Blob público com chave não adivinhável (storageKey = URL completa).
 */
import { randomBytes } from 'node:crypto';
import { env } from './env.js';

const STORE = 'siow-documents';
export const onNetlify = (): boolean => !!process.env.NETLIFY || !!process.env.NETLIFY_BLOBS_CONTEXT;

async function netlifyStore() {
  const { getStore } = await import('@netlify/blobs');
  return getStore({ name: STORE, consistency: 'strong' });
}
function vercelToken(): string {
  const t = env().BLOB_READ_WRITE_TOKEN;
  if (!t) throw new Error('BLOB_READ_WRITE_TOKEN não configurado (Vercel Blob)');
  return t;
}

/** Gera uma chave não adivinhável: `<prefix>/<name>-<token>.<ext>`. */
export function blobKey(prefix: string, name: string, ext: string): string {
  return `${prefix.replace(/^\/+|\/+$/g, '')}/${name}-${randomBytes(16).toString('hex')}.${ext}`;
}

/** Envia o conteúdo e devolve a referência a gravar em DocumentBlob.storageKey. */
export async function putBlob(key: string, buffer: Buffer | Uint8Array, contentType: string): Promise<{ url: string; pathname: string }> {
  if (onNetlify()) {
    const store = await netlifyStore();
    const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    await store.set(key, ab, { metadata: { contentType } });
    return { url: `netlify:${key}`, pathname: key };
  }
  const { put } = await import('@vercel/blob');
  const res = await put(key, buffer, { access: 'public', contentType, addRandomSuffix: false, token: vercelToken() });
  return { url: res.url, pathname: res.pathname };
}

/** URL que o navegador deve abrir. No Netlify sempre passa pela rota autenticada. */
export function getBlobUrl(storageKey: string, documentId?: string): string {
  if (storageKey.startsWith('netlify:')) return `/api/documents/${documentId ?? ''}/download?inline=0`;
  return storageKey;
}
export const isDirectUrl = (storageKey: string): boolean => !storageKey.startsWith('netlify:');

export async function deleteBlob(storageKey: string): Promise<void> {
  if (storageKey.startsWith('netlify:')) { const s = await netlifyStore(); await s.delete(storageKey.slice(8)); return; }
  const { del } = await import('@vercel/blob');
  await del(storageKey, { token: vercelToken() });
}

export async function blobExists(storageKey: string): Promise<boolean> {
  try {
    if (storageKey.startsWith('netlify:')) { const s = await netlifyStore(); return (await s.getMetadata(storageKey.slice(8))) !== null; }
    const { head } = await import('@vercel/blob');
    await head(storageKey, { token: vercelToken() }); return true;
  } catch { return false; }
}

/** Baixa o conteúdo (para streaming ou processamento no servidor). */
export async function fetchBlob(storageKey: string): Promise<Response> {
  if (storageKey.startsWith('netlify:')) {
    const s = await netlifyStore();
    const data = await s.get(storageKey.slice(8), { type: 'arrayBuffer' });
    if (!data) throw new Error('Arquivo não encontrado no armazenamento');
    return new Response(data);
  }
  const res = await fetch(storageKey, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Falha ao ler blob (${res.status})`);
  return res;
}
