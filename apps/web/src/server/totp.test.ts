import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, totpCode, verifyTotp } from './totp.js';

describe('TOTP', () => {
  it('base32 ida e volta', () => {
    const buf = Buffer.from('12345678901234567890');
    expect(base32Encode(buf)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ').equals(buf)).toBe(true);
  });
  it('vetores de teste da RFC 6238 (SHA1)', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    expect(totpCode(secret, Math.floor(59 / 30))).toBe('287082');
    expect(totpCode(secret, Math.floor(1111111109 / 30))).toBe('081804');
    expect(totpCode(secret, Math.floor(1234567890 / 30))).toBe('005924');
  });
  it('verifica com tolerância de uma janela e rejeita código errado', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    expect(verifyTotp(secret, '287082', 59_000)).toBe(true);
    expect(verifyTotp(secret, '287082', 89_000)).toBe(true);
    expect(verifyTotp(secret, '287082', 200_000)).toBe(false);
    expect(verifyTotp(secret, '12', 59_000)).toBe(false);
  });
});
