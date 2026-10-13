/**
 * Limite de requisições para rotas públicas (login, login da plataforma, autocadastro, refresh, avaliação).
 * Janela fixa por chave, contada no banco (tabela rate_limits) para valer entre todas as instâncias serverless;
 * se o banco falhar, cai para a contagem em memória da instância. O bloqueio por tentativas no login continua
 * sendo a defesa principal contra força bruta em contas reais.
 */
import { Prisma } from '@siow/db';
import { prismaPlatform } from './db.js';
import { HttpError } from './http.js';

export interface RateLimitRule { limit: number; windowMs: number }
export const RATE_RULES = {
  login: { limit: 20, windowMs: 15 * 60_000 },
  platformLogin: { limit: 10, windowMs: 15 * 60_000 },
  signup: { limit: 5, windowMs: 60 * 60_000 },
  refresh: { limit: 60, windowMs: 15 * 60_000 },
  publicWrite: { limit: 30, windowMs: 15 * 60_000 },
  mfa: { limit: 10, windowMs: 15 * 60_000 },
} as const satisfies Record<string, RateLimitRule>;

// ---- fallback em memória
interface Bucket { hits: number[] }
const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();
function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, b] of buckets) if (!b.hits.length || b.hits[b.hits.length - 1]! < now - 60 * 60_000) buckets.delete(k);
}
function memoryHit(key: string, rule: RateLimitRule, now: number): { count: number; windowStart: number } {
  sweep(now);
  const b = buckets.get(key) ?? { hits: [] };
  b.hits = b.hits.filter((t) => t > now - rule.windowMs);
  b.hits.push(now);
  buckets.set(key, b);
  return { count: b.hits.length, windowStart: b.hits[0]! };
}

let useDb = true;
async function dbHit(key: string, rule: RateLimitRule, now: number): Promise<{ count: number; windowStart: number } | null> {
  if (!useDb) return null;
  try {
    const cutoff = new Date(now - rule.windowMs);
    const rows = await prismaPlatform.$queryRaw<Array<{ count: number; windowStart: Date }>>(Prisma.sql`
      INSERT INTO "rate_limits" ("key", "count", "windowStart") VALUES (${key}, 1, ${new Date(now)})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "rate_limits"."windowStart" < ${cutoff} THEN 1 ELSE "rate_limits"."count" + 1 END,
        "windowStart" = CASE WHEN "rate_limits"."windowStart" < ${cutoff} THEN ${new Date(now)} ELSE "rate_limits"."windowStart" END
      RETURNING "count", "windowStart"`);
    const r = rows[0];
    return r ? { count: Number(r.count), windowStart: r.windowStart.getTime() } : null;
  } catch (e) {
    // Tabela ausente (migração pendente) ou banco indisponível: segue em memória nesta instância.
    useDb = false; setTimeout(() => { useDb = true; }, 5 * 60_000).unref?.();
    console.warn('[rate-limit] contagem no banco indisponível, usando memória:', e instanceof Error ? e.message : e);
    return null;
  }
}

function reject(count: number, windowStart: number, rule: RateLimitRule, now: number): never {
  const retryAfter = Math.max(1, Math.ceil((windowStart + rule.windowMs - now) / 1000));
  const e = new HttpError(429, `Muitas tentativas. Tente novamente em ${Math.ceil(retryAfter / 60)} min`);
  (e as HttpError & { retryAfter?: number }).retryAfter = retryAfter;
  throw e;
}

/** Registra a tentativa e lança 429 quando a chave excede `rule.limit` dentro da janela. */
export async function rateLimit(key: string, rule: RateLimitRule): Promise<void> {
  const now = Date.now();
  const r = (await dbHit(key, rule, now)) ?? memoryHit(key, rule, now);
  if (r.count > rule.limit) reject(r.count, r.windowStart, rule, now);
}

/** Zera a contagem de uma chave (ex.: após login bem-sucedido). */
export async function rateLimitReset(key: string): Promise<void> {
  buckets.delete(key);
  if (useDb) await prismaPlatform.rateLimit.deleteMany({ where: { key } }).catch(() => undefined);
}

/** Remove janelas antigas (cron diário). */
export async function rateLimitCleanup(): Promise<number> {
  const r = await prismaPlatform.rateLimit.deleteMany({ where: { windowStart: { lt: new Date(Date.now() - 24 * 3600_000) } } }).catch(() => ({ count: 0 }));
  return r.count;
}

/** Só para testes: força memória e limpa. */
export function _rateLimitClear(memoryOnly = true): void { buckets.clear(); if (memoryOnly) useDb = false; }
