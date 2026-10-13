/**
 * Autenticação da plataforma (superadmin Siow): PlatformAdmin + JWT próprio em cookie HttpOnly `siow_platform` (8 h).
 * Independente das organizações — roda sempre em modo plataforma (sem tenant).
 */
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { ZodError, type ZodTypeAny, type output } from 'zod';
import { prismaPlatform } from './db.js';
import { env } from './env.js';
import { csrfOk, errorResponse, forbidden, toResponse, unauthorized } from './http.js';
import { runAsPlatform } from './tenant.js';
import { verifyPassword } from './password.js';

export const PLATFORM_COOKIE = 'siow_platform';
const TTL = 8 * 3600;
const enc = (s: string) => new TextEncoder().encode(s);

export interface PlatformAdminUser { id: string; email: string; name: string }
export interface PlatformCtx { req: NextRequest; admin: PlatformAdminUser; params: Record<string, string>; query: Record<string, string>; ip: string | null; userAgent: string | null }

export async function platformLogin(email: string, password: string, meta: { ip: string | null; userAgent: string | null }): Promise<PlatformAdminUser> {
  const admin = await prismaPlatform.platformAdmin.findUnique({ where: { email: email.toLowerCase() } });
  const ok = await verifyPassword(admin?.passwordHash, password);
  const log = (action: string, after: Record<string, string>) => prismaPlatform.auditLog.create({ data: { action, resource: 'platform_auth', resourceId: admin?.id ?? null, after, justification: `plataforma:${email.toLowerCase()}`, ip: meta.ip, userAgent: meta.userAgent } }).catch(() => undefined);
  if (!admin || !ok || !admin.isActive) { await log('PLATFORM_LOGIN_FAILED', { email: email.toLowerCase(), reason: !admin ? 'UNKNOWN' : !ok ? 'BAD_PASSWORD' : 'INACTIVE' }); throw unauthorized('Credenciais inválidas'); }
  await prismaPlatform.platformAdmin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
  await log('PLATFORM_LOGIN', { email: admin.email });
  const token = await new SignJWT({ type: 'platform' }).setProtectedHeader({ alg: 'HS256' }).setSubject(admin.id).setIssuedAt().setExpirationTime(`${TTL}s`).sign(enc(env().JWT_ACCESS_SECRET));
  const jar = await cookies();
  jar.set(PLATFORM_COOKIE, token, { httpOnly: true, secure: env().COOKIE_SECURE === 'true', sameSite: 'lax', path: '/', maxAge: TTL });
  return { id: admin.id, email: admin.email, name: admin.name };
}

export async function platformLogout(): Promise<void> {
  const jar = await cookies();
  jar.set(PLATFORM_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
}

export async function getPlatformAdmin(req: NextRequest): Promise<PlatformAdminUser | null> {
  const token = req.cookies.get(PLATFORM_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, enc(env().JWT_ACCESS_SECRET));
    if (payload['type'] !== 'platform' || typeof payload.sub !== 'string') return null;
    const admin = await prismaPlatform.platformAdmin.findUnique({ where: { id: payload.sub } });
    if (!admin || !admin.isActive) return null;
    return { id: admin.id, email: admin.email, name: admin.name };
  } catch { return null; }
}

/** Rota da plataforma: exige cookie de superadmin (ou `auth: false` para o login). Executa em modo plataforma. */
export function platformRoute(fn: (ctx: PlatformCtx) => Promise<unknown>, opts: { auth?: boolean } = {}) {
  return async (req: NextRequest, rp: { params: Promise<Record<string, string>> }): Promise<Response> => {
    try {
      if (!csrfOk(req)) throw forbidden('Requisição bloqueada (CSRF)');
      const params = (await rp?.params) ?? {};
      const query = Object.fromEntries(req.nextUrl.searchParams.entries());
      let admin: PlatformAdminUser | null = null;
      if (opts.auth !== false) { admin = await getPlatformAdmin(req); if (!admin) throw unauthorized('Acesso à plataforma não autenticado'); }
      const ctx: PlatformCtx = { req, admin: admin as PlatformAdminUser, params, query, ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null, userAgent: req.headers.get('user-agent')?.slice(0, 300) ?? null };
      const result = await runAsPlatform(() => fn(ctx));
      return toResponse(result);
    } catch (e) {
      if (e instanceof ZodError) return NextResponse.json({ statusCode: 400, message: 'Dados inválidos', issues: e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }, { status: 400 });
      return errorResponse(e);
    }
  };
}

export async function platformJson<S extends ZodTypeAny>(req: NextRequest, schema: S): Promise<output<S>> {
  let body: unknown;
  try { body = await req.json(); } catch { throw new Error('JSON inválido'); }
  return schema.parse(body);
}
