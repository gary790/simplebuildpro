// ============================================================
// SimpleBuild Pro — Rate Limiter Middleware
// Production: Redis (Memorystore) backed sliding window
// Fallback: In-memory store for local development
// ============================================================

import type { MiddlewareHandler } from 'hono';
import { RATE_LIMITS } from '@simplebuildpro/shared';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// ─── Redis Client (Memorystore) ──────────────────────────────
let redisClient: any = null;
let redisAvailable = false;

async function getRedisClient() {
  if (redisClient) return redisClient;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;

  try {
    // Dynamic import — redis is optional dependency
    const { createClient } = await import('redis');
    redisClient = createClient({ url: redisUrl });

    redisClient.on('error', (err: Error) => {
      console.error('[RateLimiter] Redis error:', err.message);
      redisAvailable = false;
    });

    redisClient.on('connect', () => {
      console.log('[RateLimiter] Connected to Redis (Memorystore)');
      redisAvailable = true;
    });

    await redisClient.connect();
    redisAvailable = true;
    return redisClient;
  } catch (err: any) {
    console.warn('[RateLimiter] Redis unavailable, using in-memory fallback:', err.message);
    redisAvailable = false;
    return null;
  }
}

// Initialize Redis connection on startup (non-blocking)
getRedisClient().catch(() => {});

// ─── In-Memory Fallback Store ────────────────────────────────
const memoryStore = new Map<string, RateLimitEntry>();

// Cleanup expired entries every 60s
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryStore) {
    if (entry.resetAt <= now) memoryStore.delete(key);
  }
}, 60_000);

// ─── Redis Rate Limit Check ─────────────────────────────────
async function checkRedisRateLimit(
  key: string,
  max: number,
  windowMs: number,
): Promise<{ count: number; resetAt: number }> {
  const client = await getRedisClient();
  if (!client || !redisAvailable) {
    throw new Error('Redis not available');
  }

  const now = Date.now();
  const windowKey = `rl:${key}`;

  // Use Redis MULTI for atomic increment + expiry
  const multi = client.multi();
  multi.incr(windowKey);
  multi.pExpire(windowKey, windowMs, 'NX'); // Set expiry only if not already set
  multi.pTTL(windowKey);

  const results = await multi.exec();
  const count = results[0] as number;
  const ttl = results[2] as number;

  const resetAt = ttl > 0 ? now + ttl : now + windowMs;

  return { count, resetAt };
}

// ─── In-Memory Rate Limit Check ──────────────────────────────
function checkMemoryRateLimit(
  key: string,
  max: number,
  windowMs: number,
): { count: number; resetAt: number } {
  const now = Date.now();
  let entry = memoryStore.get(key);

  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    memoryStore.set(key, entry);
  }

  entry.count++;
  return { count: entry.count, resetAt: entry.resetAt };
}

// ─── Rate Limiter Middleware ─────────────────────────────────
type RateLimitCategory = keyof typeof RATE_LIMITS;

export function rateLimiter(category: RateLimitCategory): MiddlewareHandler {
  const config = RATE_LIMITS[category];

  return async (c, next) => {
    // Use user ID from JWT if available, fall back to IP
    const userId = c.get('userId' as any) as string | undefined;
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      c.req.header('x-real-ip') ||
      'unknown';

    const key = `${category}:${userId || ip}`;
    const now = Date.now();

    let count: number;
    let resetAt: number;

    try {
      // Try Redis first
      const result = await checkRedisRateLimit(key, config.max, config.windowMs);
      count = result.count;
      resetAt = result.resetAt;
    } catch {
      // Fallback to in-memory
      const result = checkMemoryRateLimit(key, config.max, config.windowMs);
      count = result.count;
      resetAt = result.resetAt;
    }

    // Set rate limit headers
    c.header('X-RateLimit-Limit', String(config.max));
    c.header('X-RateLimit-Remaining', String(Math.max(0, config.max - count)));
    c.header('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)));
    c.header('X-RateLimit-Backend', redisAvailable ? 'redis' : 'memory');

    if (count > config.max) {
      const retryAfter = Math.ceil((resetAt - now) / 1000);
      c.header('Retry-After', String(retryAfter));

      return c.json(
        {
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: `Too many requests. Try again in ${retryAfter} seconds.`,
          },
        },
        429,
      );
    }

    await next();
  };
}

// ─── Health Check for Redis ──────────────────────────────────
export async function getRateLimiterHealth(): Promise<{
  backend: 'redis' | 'memory';
  connected: boolean;
  latencyMs?: number;
}> {
  if (!redisAvailable || !redisClient) {
    return { backend: 'memory', connected: false };
  }

  try {
    const start = Date.now();
    await redisClient.ping();
    return {
      backend: 'redis',
      connected: true,
      latencyMs: Date.now() - start,
    };
  } catch {
    return { backend: 'redis', connected: false };
  }
}
