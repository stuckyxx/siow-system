/**
 * Limite de requisições para rotas públicas (login, login da plataforma, autocadastro, refresh, avaliação).
 * Janela deslizante em memória por instância (serverless: cada instância conta separadamente — é uma defesa
 * de custo baixo contra força bruta e abuso; o bloqueio por tentativas no login continua sendo a defesa principal).
 */
import { HttpError } from './http.js';

interface Bucket { hits: number[] }
const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

export interface RateLimitRule { limit: number; windowMs: number }
export const RATE_RULES = {
  login: { limit: 20, windowMs: 15 * 60_000 },
  platformLogin: { limit: 10, windowMs: 15 * 60_000 },
  signup: { limit: 5, windowMs: 60 * 60_000 },
  refresh: { limit: 60, windowMs: 15 * 60_000 },
  publicWrite: { limit: 30, windowMs: 15 * 60_000 },
} as const satisfies Record<string, RateLimitRule>;

function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, b] of buckets) if (!b.hits.length || b.hits[b.hits.length - 1]! < now - 60 * 60_000) buckets.delete(k);
}

/** Registra a tentativa e lança 429 quando a chave excede `rule.limit` dentro da janela. */
export function rateLimit(key: string, rule: RateLimitRule): void {
  const now = Date.now();
  sweep(now);
  const b = buckets.get(key) ?? { hits: [] };
  b.hits = b.hits.filter((t) => t > now - rule.windowMs);
  if (b.hits.length >= rule.limit) {
    const retryAfter = Math.max(1, Math.ceil((b.hits[0]! + rule.windowMs - now) / 1000));
    const e = new HttpError(429, `Muitas tentativas. Tente novamente em ${Math.ceil(retryAfter / 60)} min`);
    (e as HttpError & { retryAfter?: number }).retryAfter = retryAfter;
    throw e;
  }
  b.hits.push(now);
  buckets.set(key, b);
}

/** Zera a contagem de uma chave (ex.: após login bem-sucedido). */
export function rateLimitReset(key: string): void { buckets.delete(key); }

/** Só para testes. */
export function _rateLimitClear(): void { buckets.clear(); }
