// ============================================================
// SimpleBuild Pro — Redis Cache Service
// Structured caching layer for frequently accessed data
// Supports: project listings, user sessions, build metadata
// Falls back gracefully when Redis is unavailable
// ============================================================

import { logger } from './logger';

// ─── Types ────────────────────────────────────────────────────────────────────
interface CacheOptions {
  ttl?: number; // TTL in seconds (default: 300 = 5 min)
  prefix?: string;
}

interface CacheEntry<T> {
  data: T;
  cachedAt: number;
  ttl: number;
}

type RedisClient = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, options?: { EX?: number }) => Promise<string | null>;
  del: (key: string | string[]) => Promise<number>;
  keys: (pattern: string) => Promise<string[]>;
  mGet: (keys: string[]) => Promise<(string | null)[]>;
  ping: () => Promise<string>;
  isOpen: boolean;
};

// ─── Cache Prefixes ──────────────────────────────────────────────────────────
export const CACHE_KEYS = {
  // Project cache
  projectList: (userId: string, page: number) => `proj:list:${userId}:${page}`,
  projectDetail: (projectId: string) => `proj:detail:${projectId}`,
  projectFiles: (projectId: string) => `proj:files:${projectId}`,

  // User session/profile
  userProfile: (userId: string) => `user:profile:${userId}`,
  userSession: (sessionId: string) => `user:session:${sessionId}`,
  userPlan: (userId: string) => `user:plan:${userId}`,

  // Build & Deploy metadata
  buildStatus: (buildId: string) => `build:status:${buildId}`,
  deployStatus: (deployId: string) => `deploy:status:${deployId}`,
  siteMetadata: (slug: string) => `site:meta:${slug}`,

  // Admin/Analytics
  adminOverview: () => `admin:overview`,
  platformMetrics: () => `platform:metrics`,

  // Misc
  rateLimitBypass: (userId: string) => `rl:bypass:${userId}`,
} as const;

// ─── Default TTLs (seconds) ──────────────────────────────────────────────────
export const CACHE_TTL = {
  SHORT: 60, // 1 minute — highly dynamic data
  MEDIUM: 300, // 5 minutes — project lists, user profiles
  LONG: 900, // 15 minutes — build metadata, deploy status
  EXTENDED: 3600, // 1 hour — site metadata, admin overview
  DAY: 86400, // 24 hours — rarely changing data
} as const;

// ─── Redis Cache Service ─────────────────────────────────────────────────────
class CacheService {
  private client: RedisClient | null = null;
  private connected = false;
  private connecting = false;
  private stats = {
    hits: 0,
    misses: 0,
    errors: 0,
    sets: 0,
    deletes: 0,
  };

  /**
   * Initialize Redis connection (non-blocking)
   */
  async connect(): Promise<void> {
    if (this.connected || this.connecting) return;
    this.connecting = true;

    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      logger.warn('REDIS_URL not configured — cache disabled, using passthrough');
      this.connecting = false;
      return;
    }

    try {
      const { createClient } = await import('redis');
      const client = createClient({ url: redisUrl }) as unknown as RedisClient & {
        connect: () => Promise<void>;
        on: (event: string, cb: (...args: any[]) => void) => void;
      };

      client.on('error', (err: Error) => {
        if (this.connected) {
          logger.error('[Cache] Redis connection error', { error: err.message });
        }
        this.connected = false;
      });

      client.on('connect', () => {
        logger.info('[Cache] Redis connected');
        this.connected = true;
      });

      client.on('reconnecting', () => {
        logger.info('[Cache] Redis reconnecting...');
      });

      await client.connect();
      this.client = client as unknown as RedisClient;
      this.connected = true;
    } catch (err: any) {
      logger.warn('[Cache] Redis connection failed, running without cache', {
        error: err.message,
      });
      this.connected = false;
    } finally {
      this.connecting = false;
    }
  }

  /**
   * Get a value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.connected || !this.client) {
      this.stats.misses++;
      return null;
    }

    try {
      const raw = await this.client.get(key);
      if (!raw) {
        this.stats.misses++;
        return null;
      }

      const entry: CacheEntry<T> = JSON.parse(raw);

      // Check if expired (shouldn't happen with Redis TTL, but safety check)
      const now = Date.now();
      if (now - entry.cachedAt > entry.ttl * 1000) {
        this.stats.misses++;
        await this.client.del(key);
        return null;
      }

      this.stats.hits++;
      return entry.data;
    } catch (err: any) {
      this.stats.errors++;
      logger.error('[Cache] Get error', { key, error: err.message });
      return null;
    }
  }

  /**
   * Set a value in cache with TTL
   */
  async set<T>(key: string, data: T, ttl: number = CACHE_TTL.MEDIUM): Promise<void> {
    if (!this.connected || !this.client) return;

    try {
      const entry: CacheEntry<T> = {
        data,
        cachedAt: Date.now(),
        ttl,
      };

      await this.client.set(key, JSON.stringify(entry), { EX: ttl });
      this.stats.sets++;
    } catch (err: any) {
      this.stats.errors++;
      logger.error('[Cache] Set error', { key, error: err.message });
    }
  }

  /**
   * Delete a specific key
   */
  async del(key: string): Promise<void> {
    if (!this.connected || !this.client) return;

    try {
      await this.client.del(key);
      this.stats.deletes++;
    } catch (err: any) {
      this.stats.errors++;
      logger.error('[Cache] Del error', { key, error: err.message });
    }
  }

  /**
   * Invalidate all keys matching a pattern
   * Use sparingly — KEYS command is O(N)
   */
  async invalidatePattern(pattern: string): Promise<number> {
    if (!this.connected || !this.client) return 0;

    try {
      const keys = await this.client.keys(pattern);
      if (keys.length === 0) return 0;

      const deleted = await this.client.del(keys);
      this.stats.deletes += deleted;
      return deleted;
    } catch (err: any) {
      this.stats.errors++;
      logger.error('[Cache] InvalidatePattern error', { pattern, error: err.message });
      return 0;
    }
  }

  /**
   * Invalidate all cache for a specific user
   */
  async invalidateUser(userId: string): Promise<void> {
    await this.invalidatePattern(`user:*:${userId}`);
    await this.invalidatePattern(`proj:list:${userId}:*`);
  }

  /**
   * Invalidate all cache for a specific project
   */
  async invalidateProject(projectId: string, userId?: string): Promise<void> {
    await this.del(CACHE_KEYS.projectDetail(projectId));
    await this.del(CACHE_KEYS.projectFiles(projectId));
    // Also invalidate the user's project list cache
    if (userId) {
      await this.invalidatePattern(`proj:list:${userId}:*`);
    }
  }

  /**
   * Invalidate site metadata cache
   */
  async invalidateSite(slug: string): Promise<void> {
    await this.del(CACHE_KEYS.siteMetadata(slug));
  }

  /**
   * Get-or-set pattern: return cached value or compute and cache it
   */
  async getOrSet<T>(
    key: string,
    computeFn: () => Promise<T>,
    ttl: number = CACHE_TTL.MEDIUM,
  ): Promise<T> {
    // Try cache first
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    // Compute value
    const data = await computeFn();

    // Cache it (non-blocking)
    this.set(key, data, ttl).catch(() => {});

    return data;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      hitRate: total > 0 ? Math.round((this.stats.hits / total) * 10000) / 100 : 0,
      connected: this.connected,
    };
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{ ok: boolean; latencyMs: number }> {
    if (!this.connected || !this.client) {
      return { ok: false, latencyMs: 0 };
    }

    try {
      const start = Date.now();
      await this.client.ping();
      return { ok: true, latencyMs: Date.now() - start };
    } catch {
      return { ok: false, latencyMs: 0 };
    }
  }

  /**
   * Reset stats (useful for monitoring intervals)
   */
  resetStats(): void {
    this.stats = { hits: 0, misses: 0, errors: 0, sets: 0, deletes: 0 };
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────
export const cache = new CacheService();

// Initialize connection on import (non-blocking)
cache.connect().catch(() => {});
