/** Sessões: JWT de acesso (15 min) e refresh rotativo (7 dias) em cookies HttpOnly — assinados com `jose`. */
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { createHash, randomBytes } from 'node:crypto';
import type { CurrentUser } from '@siow/shared';
import { prisma } from './db.js';
import { env } from './env.js';

export const ACCESS_COOKIE = 'siow_access';
export const REFRESH_COOKIE = 'siow_refresh';
const ACCESS_TTL = 15 * 60;
const REFRESH_TTL = 7 * 24 * 3600;
const enc = (s: string) => new TextEncoder().encode(s);
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function loadUser(id: string): Promise<CurrentUser | null> {
  const user = await prisma.user.findFirst({ where: { id, isActive: true, deletedAt: null }, include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } });
  if (!user) return null;
  const permissions = new Set<string>(); const roles: string[] = [];
  for (const ur of user.roles) { roles.push(ur.role.name); for (const rp of ur.role.permissions) permissions.add(rp.permission.code); }
  // ajustes individuais (UserPermission): granted=true adiciona, false remove
  const up = await prisma.userPermission.findMany({ where: { userId: id }, include: { permission: true } }).catch(() => [] as Array<{ granted: boolean; permission: { code: string } }>);
  for (const x of up) { if (x.granted) permissions.add(x.permission.code); else permissions.delete(x.permission.code); }
  return { id: user.id, name: user.name, email: user.email, roles, permissions: [...permissions] };
}

export async function getCurrentUser(req: NextRequest): Promise<CurrentUser | null> {
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, enc(env().JWT_ACCESS_SECRET));
    if (payload['type'] !== 'access' || typeof payload.sub !== 'string') return null;
    const sid = payload['sid'] as string | undefined;
    if (sid) { const s = await prisma.session.findUnique({ where: { id: sid }, select: { revokedAt: true } }); if (!s || s.revokedAt) return null; }
    return loadUser(payload.sub);
  } catch { return null; }
}

export async function issueSession(userId: string, ip: string | null, userAgent: string | null): Promise<void> {
  const refreshRaw = randomBytes(48).toString('base64url');
  const session = await prisma.session.create({ data: { userId, refreshTokenHash: sha256(refreshRaw), expiresAt: new Date(Date.now() + REFRESH_TTL * 1000), ip, userAgent } });
  await setCookies(userId, session.id, refreshRaw);
}

export async function rotateSession(req: NextRequest): Promise<boolean> {
  const raw = req.cookies.get(REFRESH_COOKIE)?.value;
  if (!raw) return false;
  const s = await prisma.session.findFirst({ where: { refreshTokenHash: sha256(raw) } });
  if (!s) return false;
  if (s.revokedAt || s.expiresAt < new Date()) { await prisma.session.updateMany({ where: { userId: s.userId, revokedAt: null }, data: { revokedAt: new Date() } }); return false; }
  const next = randomBytes(48).toString('base64url');
  await prisma.session.update({ where: { id: s.id }, data: { refreshTokenHash: sha256(next), expiresAt: new Date(Date.now() + REFRESH_TTL * 1000), lastUsedAt: new Date() } });
  await setCookies(s.userId, s.id, next);
  return true;
}

export async function revokeSession(req: NextRequest): Promise<void> {
  const raw = req.cookies.get(REFRESH_COOKIE)?.value;
  if (raw) await prisma.session.updateMany({ where: { refreshTokenHash: sha256(raw) }, data: { revokedAt: new Date() } });
  await clearCookies();
}

async function setCookies(userId: string, sid: string, refreshRaw: string): Promise<void> {
  const access = await new SignJWT({ type: 'access', sid }).setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setIssuedAt().setExpirationTime(`${ACCESS_TTL}s`).sign(enc(env().JWT_ACCESS_SECRET));
  const secure = env().COOKIE_SECURE === 'true';
  const jar = await cookies();
  jar.set(ACCESS_COOKIE, access, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: ACCESS_TTL });
  jar.set(REFRESH_COOKIE, refreshRaw, { httpOnly: true, secure, sameSite: 'lax', path: '/api/auth', maxAge: REFRESH_TTL });
}
export async function clearCookies(): Promise<void> {
  const jar = await cookies();
  jar.set(ACCESS_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  jar.set(REFRESH_COOKIE, '', { httpOnly: true, path: '/api/auth', maxAge: 0 });
}
