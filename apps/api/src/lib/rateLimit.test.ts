/**
 * rateLimit.test.ts — Integration tests for the Redis-backed rate limiter (Phase 7)
 *
 * Uses the real Redis test container (REDIS_URL from env, same as setup.ts).
 * Each test uses a unique key (includes randomUUID) to avoid interference between tests.
 */

import { describe, it, expect, afterAll } from 'vitest';
import IORedis from 'ioredis';
import { checkRateLimit } from './rateLimit.js';

const redis = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });

afterAll(async () => {
  await redis.quit();
});

describe('checkRateLimit', () => {
  it('allows the first request within the window', async () => {
    const key = `test_rate:${crypto.randomUUID()}`;
    const result = await checkRateLimit(redis, key, 1, 60);
    expect(result.allowed).toBe(true);
    expect(result.resetInSeconds).toBe(0);
  });

  it('blocks the second request when limit is 1', async () => {
    const key = `test_rate:${crypto.randomUUID()}`;
    const first = await checkRateLimit(redis, key, 1, 60);
    expect(first.allowed).toBe(true);

    const second = await checkRateLimit(redis, key, 1, 60);
    expect(second.allowed).toBe(false);
    expect(second.resetInSeconds).toBeGreaterThan(0);
    expect(second.resetInSeconds).toBeLessThanOrEqual(60);
  });

  it('allows up to limit=2 and blocks the third', async () => {
    const key = `test_rate:${crypto.randomUUID()}`;
    const r1 = await checkRateLimit(redis, key, 2, 60);
    const r2 = await checkRateLimit(redis, key, 2, 60);
    const r3 = await checkRateLimit(redis, key, 2, 60);

    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(false);
  });

  it('sets a TTL on the key so the window eventually resets', async () => {
    const key = `test_rate:${crypto.randomUUID()}`;
    await checkRateLimit(redis, key, 1, 10);

    const ttl = await redis.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(10);
  });
});
