/**
 * Utilidades para Route Handlers (Next.js App Router) substituindo o NestJS:
 * autenticação por cookie JWT, permissões, CSRF, validação Zod e erros JSON.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { ZodError, type ZodTypeAny, type output } from 'zod';
import type { CurrentUser } from '@siow/shared';
import { Prisma, TenantReferenceError, collectTenantRefs } from '@siow/db';
import { prisma } from './db.js';
import { currentOrgIdOrNull } from './tenant.js';
import { getCurrentUser } from './auth.js';
import { runAsPlatform, runWithOrg } from './tenant.js';
import { moduleAllowed, moduleForPath, resolveAccess } from './access.js';
import { resolveApiKey } from './services/api-keys.js';

export class HttpError extends Error {
  constructor(public status: number, message: string, public issues?: Array<{ path: string; message: string }>) { super(message); }
}
export const badRequest = (m: string) => new HttpError(400, m);
export const unauthorized = (m = 'Não autenticado') => new HttpError(401, m);
export const forbidden = (m = 'Sem permissão') => new HttpError(403, m);
export const notFound = (m = 'Não encontrado') => new HttpError(404, m);
export const conflict = (m: string) => new HttpError(409, m);

export interface Ctx {
  req: NextRequest;
  user: CurrentUser;
  ip: string | null;
  userAgent: string | null;
  params: Record<string, string>;
  query: Record<string, string>;
}

type Handler = (ctx: Ctx) => Promise<Response | unknown>;
type RouteParams = { params: Promise<Record<string, string>> };

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function csrfOk(req: NextRequest): boolean {
  if (!MUTATING.has(req.method)) return true;
  if (req.headers.get('x-requested-with') !== 'XMLHttpRequest') return false;
  const origin = req.headers.get('origin');
  if (!origin) return true; // same-origin sem header (ex.: fetch de mesma origem em alguns navegadores)
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try { return new URL(origin).host === host; } catch { return false; }
}

export function toResponse(result: unknown): Response {
  if (result instanceof Response) return result;
  if (result === undefined || result === null) return new NextResponse(null, { status: 204 });
  return NextResponse.json(JSON.parse(JSON.stringify(result, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v instanceof Prisma.Decimal ? v.toString() : v))));
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) { const retry = (e as HttpError & { retryAfter?: number }).retryAfter; return NextResponse.json({ statusCode: e.status, message: e.message, issues: e.issues }, { status: e.status, headers: retry ? { 'Retry-After': String(retry) } : undefined }); }
  if (e instanceof TenantReferenceError) return NextResponse.json({ statusCode: 404, message: 'Registro referenciado não encontrado nesta organização', issues: [{ path: e.field, message: 'não encontrado' }] }, { status: 404 });
  if (e instanceof ZodError) return NextResponse.json({ statusCode: 400, message: 'Dados inválidos', issues: e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }, { status: 400 });
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2002') return NextResponse.json({ statusCode: 409, message: 'Registro duplicado' }, { status: 409 });
    if (e.code === 'P2025') return NextResponse.json({ statusCode: 404, message: 'Não encontrado' }, { status: 404 });
  }
  console.error(e);
  return NextResponse.json({ statusCode: 500, message: 'Erro interno' }, { status: 500 });
}

/**
 * route(['perm.a','perm.b'], async (ctx) => …)  — exige autenticação e TODAS as permissões.
 * route(null, …) — rota pública.
 */
export function route(permissions: string[] | null, fn: Handler) {
  return async (req: NextRequest, rp: RouteParams): Promise<Response> => {
    try {
      if (!csrfOk(req)) throw forbidden('Requisição bloqueada (CSRF)');
      const params = (await rp?.params) ?? {};
      const query = Object.fromEntries(req.nextUrl.searchParams.entries());
      let user: CurrentUser | null = null;
      if (permissions !== null) {
        user = await getCurrentUser(req);
        // Chave de API (integrações externas): `Authorization: Bearer sk_…` vira um usuário sintético da organização.
        if (!user) { const auth = req.headers.get('authorization') ?? ''; if (auth.startsWith('Bearer sk_')) user = await runAsPlatform(() => resolveApiKey(auth.slice(7).trim())); }
        if (!user) throw unauthorized();
        const missing = permissions.filter((p) => !user!.permissions.includes(p));
        if (missing.length) throw forbidden('Permissão necessária: ' + missing.join(', '));
        // Licenciamento (Fase 9): módulo não contratado → 403; organização em somente leitura → bloqueia mutações (exceto auth).
        const path = req.nextUrl.pathname;
        if (!path.startsWith('/api/auth/')) {
          const access = await resolveAccess(user.organizationId);
          user.access = access;
          const mod = moduleForPath(path);
          if (!moduleAllowed(access, mod)) throw new HttpError(403, `Módulo não incluído no seu plano (${access.planName}). Fale com a Siow System para habilitar ${mod}.`);
          if (access.readOnly && MUTATING.has(req.method)) throw new HttpError(423, access.blockReason ?? 'Organização em modo somente leitura');
        }
      }
      const ctx: Ctx = { req, user: user as CurrentUser, params, query, ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null, userAgent: req.headers.get('user-agent')?.slice(0, 300) ?? null };
      // Rota autenticada: tudo roda dentro da organização do usuário. Rota pública: modo plataforma (sem tenant).
      const result = user ? await runWithOrg(user.organizationId, () => fn(ctx)) : await runAsPlatform(() => fn(ctx));
      return toResponse(result);
    } catch (e) { return errorResponse(e); }
  };
}

export async function json<S extends ZodTypeAny>(req: NextRequest, schema: S): Promise<output<S>> {
  let body: unknown;
  try { body = await req.json(); } catch { throw badRequest('JSON inválido'); }
  const parsed = schema.parse(body);
  await assertTenantRefs(parsed);
  return parsed;
}

/**
 * Isolamento na borda: todo id de registro tenant informado pelo cliente (entityId, contractId, assigneeUserId, roleIds…)
 * precisa existir na organização atual; caso contrário 404, sem revelar se o id existe em outra organização.
 */
export async function assertTenantRefs(body: unknown): Promise<void> {
  if (!currentOrgIdOrNull()) return;
  const refs = collectTenantRefs(body);
  if (!refs.length) return;
  const seen = new Set<string>();
  await Promise.all(refs.filter((r) => { const k = `${r.model}:${r.id}`; if (seen.has(k)) return false; seen.add(k); return true; }).map(async (r) => {
    const delegate = (prisma as unknown as Record<string, { count: (x: { where: Record<string, unknown> }) => Promise<number> }>)[r.model.charAt(0).toLowerCase() + r.model.slice(1)];
    if (!delegate) return;
    const n = await delegate.count({ where: { id: r.id } }).catch(() => 1); // id inválido para o Prisma → deixa a validação de formato responder
    if (n === 0) throw new TenantReferenceError(r.field, r.model, r.id);
  }));
}
export function parseQuery<S extends ZodTypeAny>(query: Record<string, string>, schema: S): output<S> { return schema.parse(query); }
