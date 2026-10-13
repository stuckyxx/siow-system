/**
 * Autenticação em dois fatores (TOTP) para usuários e superadmins da plataforma.
 * Fluxo: setup (gera segredo pendente, cifrado) → enable (confirma com um código) → login exige código →
 * disable (senha + código). O segredo nunca é devolvido depois da ativação.
 */
import { SignJWT, jwtVerify } from 'jose';
import { decryptSecret, encryptSecret } from '../crypto.js';
import { prisma, prismaPlatform } from '../db.js';
import { env } from '../env.js';
import { badRequest, unauthorized, type Ctx } from '../http.js';
import { verifyPassword } from '../password.js';
import { generateTotpSecret, otpauthUrl, verifyTotp } from '../totp.js';
import { audit } from '../audit.js';

const enc = (s: string) => new TextEncoder().encode(s);
const MFA_TTL = 5 * 60;
type Kind = 'user' | 'platform';

/** Token curto emitido após senha correta, quando a conta exige 2FA. */
export async function issueMfaToken(kind: Kind, id: string): Promise<string> {
  return new SignJWT({ type: 'mfa', kind }).setProtectedHeader({ alg: 'HS256' }).setSubject(id).setIssuedAt().setExpirationTime(`${MFA_TTL}s`).sign(enc(env().JWT_ACCESS_SECRET));
}
export async function readMfaToken(token: string, kind: Kind): Promise<string> {
  try {
    const { payload } = await jwtVerify(token, enc(env().JWT_ACCESS_SECRET));
    if (payload['type'] !== 'mfa' || payload['kind'] !== kind || typeof payload.sub !== 'string') throw new Error('x');
    return payload.sub;
  } catch { throw unauthorized('Verificação expirada. Entre novamente.'); }
}

interface Holder { totpSecret: string | null; totpEnabledAt: Date | null; email: string }
async function load(kind: Kind, id: string): Promise<Holder> {
  const row = kind === 'user' ? await prismaPlatform.user.findUnique({ where: { id }, select: { totpSecret: true, totpEnabledAt: true, email: true } }) : await prismaPlatform.platformAdmin.findUnique({ where: { id }, select: { totpSecret: true, totpEnabledAt: true, email: true } });
  if (!row) throw unauthorized();
  return row;
}
async function save(kind: Kind, id: string, data: { totpSecret: string | null; totpEnabledAt: Date | null }): Promise<void> {
  if (kind === 'user') await prismaPlatform.user.update({ where: { id }, data }); else await prismaPlatform.platformAdmin.update({ where: { id }, data });
}

export const mfaEnabled = (h: { totpSecret: string | null; totpEnabledAt: Date | null }): boolean => Boolean(h.totpSecret && h.totpEnabledAt);

/** Confere o código de uma conta com 2FA ativo. */
export async function checkCode(kind: Kind, id: string, code: string): Promise<boolean> {
  const h = await load(kind, id);
  if (!mfaEnabled(h)) return true;
  return verifyTotp(decryptSecret(h.totpSecret!), code);
}

export async function status(kind: Kind, id: string) {
  const h = await load(kind, id);
  return { enabled: mfaEnabled(h), pending: Boolean(h.totpSecret && !h.totpEnabledAt) };
}

/** Gera (ou regenera) um segredo pendente e devolve o segredo + URL otpauth para o app autenticador. */
export async function setup(kind: Kind, id: string, issuer = 'Siow System') {
  const h = await load(kind, id);
  if (mfaEnabled(h)) throw badRequest('2FA já está ativo. Desative antes de configurar novamente.');
  const secret = generateTotpSecret();
  await save(kind, id, { totpSecret: encryptSecret(secret), totpEnabledAt: null });
  return { secret, otpauth: otpauthUrl(issuer, h.email, secret) };
}

export async function enable(kind: Kind, id: string, code: string, ctx: Pick<Ctx, 'user' | 'ip' | 'userAgent'> | null) {
  const h = await load(kind, id);
  if (!h.totpSecret) throw badRequest('Inicie a configuração do 2FA primeiro.');
  if (mfaEnabled(h)) return { enabled: true };
  if (!verifyTotp(decryptSecret(h.totpSecret), code)) throw badRequest('Código inválido. Confira o relógio do celular e tente de novo.');
  await save(kind, id, { totpSecret: h.totpSecret, totpEnabledAt: new Date() });
  await audit(ctx, { action: 'MFA_ENABLED', resource: kind === 'user' ? 'user' : 'platform_admin', resourceId: id });
  return { enabled: true };
}

export async function disable(kind: Kind, id: string, password: string, code: string, ctx: Pick<Ctx, 'user' | 'ip' | 'userAgent'> | null) {
  const h = await load(kind, id);
  const row = kind === 'user' ? await prismaPlatform.user.findUniqueOrThrow({ where: { id }, select: { passwordHash: true } }) : await prismaPlatform.platformAdmin.findUniqueOrThrow({ where: { id }, select: { passwordHash: true } });
  if (!(await verifyPassword(row.passwordHash, password))) throw unauthorized('Senha incorreta');
  if (mfaEnabled(h) && !verifyTotp(decryptSecret(h.totpSecret!), code)) throw badRequest('Código inválido');
  await save(kind, id, { totpSecret: null, totpEnabledAt: null });
  await audit(ctx, { action: 'MFA_DISABLED', resource: kind === 'user' ? 'user' : 'platform_admin', resourceId: id });
  return { enabled: false };
}

/** Administrador da organização pode desligar o 2FA de um usuário que perdeu o celular (auditado). */
export async function adminReset(ctx: Ctx, userId: string) {
  const u = await prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true } });
  if (!u) throw badRequest('Usuário não encontrado');
  await save('user', userId, { totpSecret: null, totpEnabledAt: null });
  await audit(ctx, { action: 'MFA_RESET_BY_ADMIN', resource: 'user', resourceId: userId });
  return { ok: true };
}
