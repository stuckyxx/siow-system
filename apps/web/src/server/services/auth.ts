/**
 * Autenticação: login com bloqueio por tentativas, troca de senha e sessão.
 * Cookies/JWT ficam em server/auth.ts; aqui só regras de negócio.
 */
import { prisma } from '../db.js';
import { audit } from '../audit.js';
import { REFRESH_COOKIE, issueSession, sha256 } from '../auth.js';
import { hashPassword, isStrongPassword, verifyPassword } from '../password.js';
import { badRequest, unauthorized, type Ctx } from '../http.js';

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

export interface LoginUser { id: string; name: string; email: string; mustChangePassword: boolean }

type Meta = Pick<Ctx, 'ip' | 'userAgent'>;

export async function login(email: string, password: string, meta: Meta): Promise<LoginUser> {
  const normalized = email.toLowerCase();
  const user = await prisma.user.findFirst({ where: { email: normalized, deletedAt: null } });

  // Conta bloqueada: não verifica a senha (não revela se está correta)
  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    await audit(null, { action: 'LOGIN_FAILED', resource: 'auth', after: { email: normalized, ip: meta.ip, reason: 'LOCKED' } });
    const minutes = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000));
    throw unauthorized(`Conta bloqueada por tentativas inválidas. Tente novamente em ${minutes} min`);
  }

  // Sempre executa a verificação (mesmo custo) para não revelar existência do e-mail
  const ok = await verifyPassword(user?.passwordHash, password);
  if (!user || !ok || !user.isActive) {
    if (user && !ok) {
      const failed = user.failedLoginCount + 1;
      const lock = failed >= MAX_FAILED_LOGINS;
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null },
      });
      if (lock) await audit(null, { action: 'ACCOUNT_LOCKED', resource: 'user', resourceId: user.id, after: { email: normalized, ip: meta.ip, minutes: LOCKOUT_MINUTES } });
    }
    await audit(null, { action: 'LOGIN_FAILED', resource: 'auth', after: { email: normalized, ip: meta.ip, reason: !user ? 'UNKNOWN' : !ok ? 'BAD_PASSWORD' : 'INACTIVE' } });
    throw unauthorized('Credenciais inválidas');
  }

  await issueSession(user.id, meta.ip, meta.userAgent);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null } });
  await audit(
    { user: { id: user.id, name: user.name, email: user.email, roles: [], permissions: [] }, ip: meta.ip, userAgent: meta.userAgent },
    { action: 'LOGIN', resource: 'auth', resourceId: user.id },
  );
  return { id: user.id, name: user.name, email: user.email, mustChangePassword: user.mustChangePassword };
}

export async function changePassword(ctx: Ctx, currentPassword: string, newPassword: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
  if (!(await verifyPassword(user.passwordHash, currentPassword))) throw unauthorized('Senha atual incorreta');
  if (!isStrongPassword(newPassword)) throw badRequest('Senha fraca: mínimo 10 caracteres com letras, números e símbolo');
  if (currentPassword === newPassword) throw badRequest('A nova senha deve ser diferente da atual');
  const passwordHash = await hashPassword(newPassword);
  // mantém a sessão atual (cookie de refresh, path /api/auth) e revoga as demais
  const currentRefresh = ctx.req.cookies.get(REFRESH_COOKIE)?.value;
  const keep = currentRefresh ? { refreshTokenHash: { not: sha256(currentRefresh) } } : {};
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false, failedLoginCount: 0, lockedUntil: null } }),
    prisma.session.updateMany({ where: { userId: user.id, revokedAt: null, ...keep }, data: { revokedAt: new Date() } }),
  ]);
  await audit(ctx, { action: 'PASSWORD_CHANGED', resource: 'user', resourceId: user.id });
}

export async function mustChangePassword(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { mustChangePassword: true } });
  return u?.mustChangePassword ?? false;
}
