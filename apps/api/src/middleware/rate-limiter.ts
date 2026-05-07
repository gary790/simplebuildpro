// ============================================================
// SimpleBuild Pro — Rate Limiter Middleware
// Sliding window rate limiter backed by in-memory store
// In production, swap to Redis (Memorystore) for multi-instance
// ============================================================

import type { MiddlewareHandler } from 'hono';
import { RATE_LIMITS } from '@simplebuildpro/shared';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory store — replace with Redis in production cluster
const store = new Map<string, RateLimitEntry>();

// Cleanup expired entries every 60s
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key);
  }
}, 60_000);

type RateLimitCategory = keyof typeof RATE_LIMITS;

export function rateLimiter(category: RateLimitCategory): MiddlewareHandler {
  const config = RATE_LIMITS[category];

  return async (c, next) => {
    // Use user ID from JWT if available, fall back to IP
    const userId = c.get('userId' as any) as string | undefined;
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      || c.req.header('x-real-ip')
      || 'unknown';

    const key = `${category}:${userId || ip}`;
    const now = Date.now();

    let entry = store.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + config.windowMs };
      store.set(key, entry);
    }

    entry.count++;

    // Set rate limit headers
    c.header('X-RateLimit-Limit', String(config.max));
    c.header('X-RateLimit-Remaining', String(Math.max(0, config.max - entry.count)));
    c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > config.max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      c.header('Retry-After', String(retryAfter));

      return c.json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Too many requests. Try again in ${retryAfter} seconds.`,
        },
      }, 429);
    }

    await next();
  };
}
