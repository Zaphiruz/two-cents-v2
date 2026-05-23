/**
 * rateLimit.ts — Redis-backed sliding counter rate limiter (Phase 7)
 *
 * Uses INCR + EXPIRE (set once on first increment) to implement a fixed-window
 * rate limiter. Lightweight and dependency-free beyond ioredis.
 *
 * Usage:
 *   const result = await checkRateLimit(app.redis, `feedback_rate:${userId}`, 1, 60);
 *   if (!result.allowed) {
 *     reply.code(429).send({ error: 'rate_limited', resetInSeconds: result.resetInSeconds });
 *     return;
 *   }
 */

import type IORedis from 'ioredis';

export interface RateLimitResult {
  allowed: boolean;
  /** Approximate seconds until the window resets (0 when allowed). */
  resetInSeconds: number;
}

/**
 * Increment a Redis counter for `key`. Allow if the new value ≤ `limitPerWindow`.
 * Sets TTL = `windowSeconds` on the first increment (when count is 1).
 *
 * @param redis           IORedis client
 * @param key             Cache key, e.g. `feedback_rate:42`
 * @param limitPerWindow  Max allowed increments in the window (e.g. 1)
 * @param windowSeconds   Window duration in seconds (e.g. 60)
 */
export async function checkRateLimit(
  redis: IORedis,
  key: string,
  limitPerWindow: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const count = await redis.incr(key);

  if (count === 1) {
    // First request in this window — set expiry
    await redis.expire(key, windowSeconds);
  }

  if (count > limitPerWindow) {
    const ttl = await redis.ttl(key);
    // ttl may be -1 if the key has no expiry (race condition safety) or -2 if gone;
    // fall back to windowSeconds in those edge cases.
    const resetInSeconds = ttl > 0 ? ttl : windowSeconds;
    return { allowed: false, resetInSeconds };
  }

  return { allowed: true, resetInSeconds: 0 };
}
