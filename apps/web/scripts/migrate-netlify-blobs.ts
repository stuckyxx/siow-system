/**
 * Migração dos arquivos gravados no Netlify Blobs (storageKey "netlify:<chave>") para o Vercel Blob.
 *
 * Lê cada arquivo pela rota autenticada do site antigo (ainda no ar na Netlify), grava no Vercel Blob
 * com a mesma chave e atualiza document_blobs.storageKey para a URL pública não adivinhável.
 * Idempotente: documentos já migrados (chave sem "netlify:") são ignorados; pode rodar de novo.
 *
 * Uso (na raiz do repositório):
 *   OLD_APP_URL=https://siow-system.netlify.app OLD_LOGIN_EMAIL=... OLD_LOGIN_PASSWORD=... \
 *   DATABASE_URL=... BLOB_READ_WRITE_TOKEN=... pnpm --filter @siow/web migrate:blobs
 */
import { put } from '@vercel/blob';
import { prisma } from '@siow/db';

const need = (k: string): string => { const v = process.env[k]; if (!v) throw new Error(`Variável ${k} obrigatória`); return v; };
const OLD = need('OLD_APP_URL').replace(/\/$/, '');
const TOKEN = need('BLOB_READ_WRITE_TOKEN');

async function login(): Promise<string> {
  const res = await fetch(`${OLD}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify({ email: need('OLD_LOGIN_EMAIL'), password: need('OLD_LOGIN_PASSWORD') }),
  });
  if (!res.ok) throw new Error(`Login no site antigo falhou (${res.status})`);
  const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0]!).join('; ');
  if (!cookies) throw new Error('Login não devolveu cookies');
  return cookies;
}

async function main(): Promise<void> {
  const blobs = await prisma.documentBlob.findMany({ where: { storageKey: { startsWith: 'netlify:' } }, include: { documents: { where: { deletedAt: null }, take: 1, select: { id: true, name: true } } } });
  console.log(`${blobs.length} arquivo(s) no Netlify Blobs para migrar`);
  if (!blobs.length) return;
  const cookie = await login();
  let ok = 0;
  for (const b of blobs) {
    const doc = b.documents[0];
    const key = b.storageKey.slice('netlify:'.length);
    if (!doc) { console.warn(`- ${key}: sem documento ativo; ignorado`); continue; }
    try {
      const res = await fetch(`${OLD}/api/documents/${doc.id}/download?inline=0`, { headers: { Cookie: cookie } });
      if (!res.ok) throw new Error(`download ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length !== b.size) console.warn(`  aviso: tamanho ${buf.length} ≠ ${b.size} registrado`);
      const up = await put(key, buf, { access: 'public', contentType: b.mimeType, addRandomSuffix: false, token: TOKEN });
      await prisma.documentBlob.update({ where: { id: b.id }, data: { storageKey: up.url } });
      ok += 1;
      console.log(`✓ ${doc.name} (${buf.length} bytes) → ${up.url}`);
    } catch (e) {
      console.error(`✗ ${doc.name}: ${(e as Error).message}`);
    }
  }
  console.log(`Migrados: ${ok}/${blobs.length}`);
}

main().finally(() => prisma.$disconnect());
