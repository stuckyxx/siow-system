import { beforeEach, describe, expect, it } from 'vitest';
import { HttpError } from './http.js';
import { _rateLimitClear, rateLimit, rateLimitReset } from './rate-limit.js';

describe('rateLimit', () => {
  beforeEach(() => _rateLimitClear());
  it('permite até o limite e devolve 429 depois', () => {
    const rule = { limit: 3, windowMs: 60_000 };
    rateLimit('k', rule); rateLimit('k', rule); rateLimit('k', rule);
    expect(() => rateLimit('k', rule)).toThrowError(HttpError);
    try { rateLimit('k', rule); } catch (e) { expect((e as HttpError).status).toBe(429); }
  });
  it('chaves independentes e reset', () => {
    const rule = { limit: 1, windowMs: 60_000 };
    rateLimit('a', rule);
    expect(() => rateLimit('b', rule)).not.toThrow();
    rateLimitReset('a');
    expect(() => rateLimit('a', rule)).not.toThrow();
  });
});
