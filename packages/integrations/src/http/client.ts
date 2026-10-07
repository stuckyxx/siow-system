import { ProviderError } from '../types.js';

export interface HttpRequestOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string | URLSearchParams | FormData;
  timeoutMs: number;
  userAgent: string;
  /** tentativas totais (inclui a primeira). Padrão 3. */
  attempts?: number;
  /** atraso base para backoff exponencial (ms). Padrão 500. */
  backoffBaseMs?: number;
  fetchImpl?: typeof fetch;
  /** requisições com efeitos colaterais não devem ser repetidas automaticamente */
  idempotent?: boolean;
}

export interface HttpResponse {
  status: number;
  headers: Headers;
  buffer: Buffer;
  text: () => string;
  url: string;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Cliente HTTP mínimo com timeout (AbortController), retry com backoff
 * exponencial + jitter e classificação de erros (retryable ou não).
 */
export async function httpRequest(url: string, opts: HttpRequestOptions): Promise<HttpResponse> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const attempts = Math.max(1, opts.idempotent === false ? 1 : (opts.attempts ?? 3));
  const base = opts.backoffBaseMs ?? 500;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: opts.method ?? 'GET',
        headers: {
          'User-Agent': opts.userAgent,
          Accept: 'text/html,application/xhtml+xml,application/pdf,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9',
          ...(opts.headers ?? {}),
        },
        body: opts.body,
        signal: controller.signal,
        redirect: 'follow',
      });
      const buffer = Buffer.from(await res.arrayBuffer());
      if (RETRYABLE_STATUS.has(res.status) && attempt < attempts) {
        lastError = new ProviderError(`HTTP ${res.status} em ${url}`, true, res.status);
        await sleep(base * 2 ** (attempt - 1) + Math.random() * 250);
        continue;
      }
      if (res.status >= 400) {
        throw new ProviderError(`HTTP ${res.status} em ${url}`, RETRYABLE_STATUS.has(res.status), res.status);
      }
      return {
        status: res.status,
        headers: res.headers,
        buffer,
        text: () => buffer.toString('utf8'),
        url: res.url || url,
      };
    } catch (err) {
      if (err instanceof ProviderError && !err.retryable) throw err;
      lastError = err;
      const aborted = err instanceof Error && err.name === 'AbortError';
      if (attempt < attempts) {
        await sleep(base * 2 ** (attempt - 1) + Math.random() * 250);
        continue;
      }
      throw new ProviderError(
        aborted ? `Timeout (${opts.timeoutMs}ms) em ${url}` : `Falha de rede em ${url}: ${(err as Error).message}`,
        true,
        undefined,
        { cause: err },
      );
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new ProviderError('Falha desconhecida', true);
}
