// ============================================================
// SimpleBuild Pro — Health Check Routes
// Cloud Run compatible: liveness, readiness, startup probes
// ============================================================

import { Hono } from 'hono';
import { checkDbHealth } from '@simplebuildpro/db';

export const healthRoutes = new Hono();

const startTime = Date.now();

// ─── Main Health Check (detailed) ─────────────────────────────────────
healthRoutes.get('/', async (c) => {
  const dbHealth = await checkDbHealth();
  const redisHealth = await checkRedisHealth();

  const allHealthy = dbHealth.ok && redisHealth.ok;
  const status = allHealthy ? 200 : 503;

  return c.json({
    status: allHealthy ? 'healthy' : 'degraded',
    version: process.env.APP_VERSION || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    uptimeHuman: formatUptime(process.uptime()),
    checks: {
      database: {
        status: dbHealth.ok ? 'ok' : 'error',
        latencyMs: dbHealth.latencyMs,
        ...(dbHealth.error ? { error: dbHealth.error } : {}),
      },
      redis: {
        status: redisHealth.ok ? 'ok' : 'error',
        latencyMs: redisHealth.latencyMs,
        ...(redisHealth.error ? { error: redisHealth.error } : {}),
      },
    },
    system: {
      memory: getMemoryUsage(),
      nodeVersion: process.version,
      pid: process.pid,
    },
  }, status);
});

// ─── Readiness Probe (Cloud Run) ──────────────────────────────────────
// Returns 200 only when the service can handle requests
healthRoutes.get('/ready', async (c) => {
  const dbHealth = await checkDbHealth();
  const redisHealth = await checkRedisHealth();

  if (!dbHealth.ok) {
    return c.json({ 
      ready: false, 
      reason: 'Database not reachable',
      details: { latencyMs: dbHealth.latencyMs, error: dbHealth.error }
    }, 503);
  }

  // Redis is non-critical (fallback to in-memory rate limiter exists)
  return c.json({ 
    ready: true,
    dependencies: {
      database: 'ok',
      redis: redisHealth.ok ? 'ok' : 'degraded',
    }
  });
});

// ─── Liveness Probe (Cloud Run) ───────────────────────────────────────
// Simple check that the process is alive — no dependency checks
healthRoutes.get('/live', (c) => {
  return c.json({ 
    alive: true,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ─── Startup Probe (Cloud Run) ────────────────────────────────────────
// Used during container startup — gives extra time for initialization
healthRoutes.get('/startup', (c) => {
  const uptimeMs = Date.now() - startTime;
  // Consider started after 2 seconds (DB pool initialized)
  const started = uptimeMs > 2000;
  
  return c.json({ 
    started,
    uptimeMs,
  }, started ? 200 : 503);
});

// ─── Metrics endpoint (for monitoring) ────────────────────────────────
healthRoutes.get('/metrics', async (c) => {
  const dbHealth = await checkDbHealth();
  const redisHealth = await checkRedisHealth();

  return c.json({
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: getMemoryUsage(),
    dependencies: {
      database: {
        healthy: dbHealth.ok,
        latencyMs: dbHealth.latencyMs,
      },
      redis: {
        healthy: redisHealth.ok,
        latencyMs: redisHealth.latencyMs,
      },
    },
    process: {
      pid: process.pid,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    },
  });
});

// ─── Helper: Check Redis Health ───────────────────────────────────────
async function checkRedisHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      return { ok: false, latencyMs: 0, error: 'REDIS_URL not configured' };
    }

    // Attempt a simple TCP connection check
    const url = new URL(redisUrl);
    const { createConnection } = await import('net');
    
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ ok: false, latencyMs: Date.now() - start, error: 'Connection timeout' });
      }, 3000);

      const socket = createConnection({
        host: url.hostname,
        port: parseInt(url.port) || 6379,
      }, () => {
        clearTimeout(timeout);
        socket.write('PING\r\n');
      });

      socket.on('data', (data) => {
        const response = data.toString().trim();
        socket.destroy();
        resolve({ 
          ok: response.includes('PONG'), 
          latencyMs: Date.now() - start 
        });
      });

      socket.on('error', (err) => {
        clearTimeout(timeout);
        socket.destroy();
        resolve({ ok: false, latencyMs: Date.now() - start, error: err.message });
      });
    });
  } catch (error: any) {
    return { ok: false, latencyMs: Date.now() - start, error: error.message };
  }
}

// ─── Helper: Get Memory Usage ─────────────────────────────────────────
function getMemoryUsage() {
  const mem = process.memoryUsage();
  return {
    rss: `${Math.round(mem.rss / 1024 / 1024)}MB`,
    heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
    heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024)}MB`,
    external: `${Math.round(mem.external / 1024 / 1024)}MB`,
  };
}

// ─── Helper: Format Uptime ────────────────────────────────────────────
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);
  
  return parts.join(' ');
}
