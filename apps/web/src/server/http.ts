/**
 * Utilidades para Route Handlers (Next.js App Router) substituindo o NestJS:
 * autenticação por cookie JWT, permissões, CSRF, validação Zod e erros JSON.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { ZodError, type ZodType } from 'zod';
import type { CurrentUser } from '@siow/shared';
import { Prisma } from '@siow/db';
import { getCurrentUser } from './auth.js';

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
  if (e instanceof HttpError) return NextResponse.json({ statusCode: e.status, message: e.message, issues: e.issues }, { status: e.status });
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
  return async (req: NextRequest, rp?: RouteParams): Promise<Response> => {
    try {
      if (!csrfOk(req)) throw forbidden('Requisição bloqueada (CSRF)');
      const params = rp ? await rp.params : {};
      const query = Object.fromEntries(req.nextUrl.searchParams.entries());
      let user: CurrentUser | null = null;
      if (permissions !== null) {
        user = await getCurrentUser(req);
        if (!user) throw unauthorized();
        const missing = permissions.filter((p) => !user!.permissions.includes(p));
        if (missing.length) throw forbidden('Permissão necessária: ' + missing.join(', '));
      }
      const ctx: Ctx = { req, user: user as CurrentUser, params, query, ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null, userAgent: req.headers.get('user-agent')?.slice(0, 300) ?? null };
      return toResponse(await fn(ctx));
    } catch (e) { return errorResponse(e); }
  };
}

export async function json<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try { body = await req.json(); } catch { throw badRequest('JSON inválido'); }
  return schema.parse(body);
}
export function parseQuery<T>(query: Record<string, string>, schema: ZodType<T>): T { return schema.parse(query); }
