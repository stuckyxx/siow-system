/**
 * TOTP (RFC 6238, HMAC-SHA1, 6 dígitos, 30 s) sem dependências — compatível com Google Authenticator, Authy, 1Password etc.
 * O segredo é guardado cifrado (crypto.ts) e nunca devolvido depois da ativação.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of clean) { value = (value << 5) | ALPHABET.indexOf(ch); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}

export function generateTotpSecret(): string { return base32Encode(randomBytes(20)); }

export function totpCode(secret: string, counter: number): string {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const offset = h[h.length - 1]! & 0xf;
  const code = ((h[offset]! & 0x7f) << 24) | (h[offset + 1]! << 16) | (h[offset + 2]! << 8) | h[offset + 3]!;
  return String(code % 1_000_000).padStart(6, '0');
}

/** Verifica o código aceitando ±1 janela de 30 s (relógio do celular ligeiramente fora). */
export function verifyTotp(secret: string, code: string, now = Date.now()): boolean {
  const clean = code.replace(/\D/g, '');
  if (clean.length !== 6) return false;
  const counter = Math.floor(now / 30_000);
  for (const c of [counter - 1, counter, counter + 1]) {
    const expected = totpCode(secret, c);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return true;
  }
  return false;
}

export function otpauthUrl(issuer: string, account: string, secret: string): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
