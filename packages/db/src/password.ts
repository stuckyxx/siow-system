/**
 * Hash de senha com scrypt (node:crypto) — sem dependência nativa, funciona em
 * qualquer runtime Node (Vercel, Docker, CLI). Compartilhado entre o seed e a aplicação.
 *
 * Formato armazenado: `scrypt$N$r$p$<salt base64>$<chave base64>`
 */
import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

type ScryptParams = { N: number; r: number; p: number; maxmem?: number };
const scrypt = promisify(_scrypt) as (
  pwd: string,
  salt: Buffer,
  len: number,
  opts: ScryptParams,
) => Promise<Buffer>;

const PARAMS: ScryptParams = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(hash: string | null | undefined, password: string): Promise<boolean> {
  if (!hash) {
    await scrypt(password, randomBytes(16), 64, PARAMS); // tempo constante (PARAMS já inclui maxmem)
    return false;
  }
  const [alg, N, r, p, saltB64, keyB64] = hash.split('$');
  if (alg !== 'scrypt' || !N || !r || !p || !saltB64 || !keyB64) return false;
  // maxmem é obrigatório: N=2^15, r=8 precisa de 32 MiB, exatamente o limite padrão do Node — sem ele a verificação lança erro.
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), 64, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: PARAMS.maxmem,
  });
  const expected = Buffer.from(keyB64, 'base64');
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Mínimo 10 caracteres com letras, números e ao menos um símbolo. */
export const isStrongPassword = (p: string): boolean =>
  p.length >= 10 && /[a-zA-Z]/.test(p) && /\d/.test(p) && /[^a-zA-Z0-9]/.test(p);
