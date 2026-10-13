import { beforeEach, describe, expect, it } from 'vitest';
import { HttpError } from './http.js';
import { _rateLimitClear, rateLimit, rateLimitReset } from './rate-limit.js';

describe('rateLimit (memória)', () => {
  beforeEach(() => _rateLimitClear(true));
  it('permite até o limite e devolve 429 depois', async () => {
    const rule = { limit: 3, windowMs: 60_000 };
    await rateLimit('k', rule); await rateLimit('k', rule); await rateLimit('k', rule);
    await expect(rateLimit('k', rule)).rejects.toBeInstanceOf(HttpError);
    await rateLimit('k', rule).catch((e: HttpError) => expect(e.status).toBe(429));
  });
  it('chaves independentes e reset', async () => {
    const rule = { limit: 1, windowMs: 60_000 };
    await rateLimit('a', rule);
    await expect(rateLimit('b', rule)).resolves.toBeUndefined();
    await rateLimitReset('a');
    await expect(rateLimit('a', rule)).resolves.toBeUndefined();
  });
});
