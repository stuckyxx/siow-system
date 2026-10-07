import { describe, expect, it } from 'vitest';
import { hashPassword, isStrongPassword, verifyPassword } from './password.js';

describe('password (scrypt)', () => {
  it('verifica o hash gerado (regressão: maxmem precisa ser repassado na verificação)', async () => {
    const h = await hashPassword('Senha@Forte123');
    expect(h.startsWith('scrypt$32768$8$1$')).toBe(true);
    await expect(verifyPassword(h, 'Senha@Forte123')).resolves.toBe(true);
    await expect(verifyPassword(h, 'outra')).resolves.toBe(false);
  });
  it('rejeita hash ausente ou malformado', async () => {
    await expect(verifyPassword(null, 'x')).resolves.toBe(false);
    await expect(verifyPassword('bcrypt$abc', 'x')).resolves.toBe(false);
  });
  it('política de senha forte', () => {
    expect(isStrongPassword('Senha@Forte123')).toBe(true);
    expect(isStrongPassword('curta1!')).toBe(false);
    expect(isStrongPassword('semsimbolo123')).toBe(false);
  });
});
