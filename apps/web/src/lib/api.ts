/**
 * Cliente HTTP do frontend. Cookies HttpOnly (credentials: include), header
 * anti-CSRF e renovação automática do access token (uma tentativa) em 401.
 * O frontend NUNCA acessa o Portal do Cliente — só a nossa API.
 */
/** Vazio = mesma origem (Route Handlers em /api no próprio deploy Vercel). Defina NEXT_PUBLIC_API_URL só para apontar a uma API externa. */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly issues?: Array<{ path: string; message: string }>,
  ) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;

async function refresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = fetch(`${API_URL}/api/auth/refresh`, { method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => setTimeout(() => (refreshing = null), 0));
  }
  return refreshing;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  formData?: FormData;
  raw?: boolean;
}

export function buildQuery(query?: RequestOptions['query']): string {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function api<T>(path: string, opts: RequestOptions = {}, retried = false): Promise<T> {
  const res = await fetch(`${API_URL}/api${path}${buildQuery(opts.query)}`, {
    method: opts.method ?? 'GET',
    credentials: 'include',
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.formData ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  if (res.status === 401 && !retried && !path.startsWith('/auth/')) {
    if (await refresh()) return api<T>(path, opts, true);
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string; message?: string; issues?: Array<{ path: string; message: string }> } | null;
    throw new ApiError(res.status, data?.error ?? data?.message ?? `Erro ${res.status}`, data?.issues);
  }
  if (opts.raw) return (await res.blob()) as unknown as T;
  return (await res.json()) as T;
}

export function apiUrl(path: string, query?: RequestOptions['query']): string {
  return `${API_URL}/api${path}${buildQuery(query)}`;
}
