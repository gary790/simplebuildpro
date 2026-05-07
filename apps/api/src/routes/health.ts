// ============================================================
// SimpleBuild Pro — Health Check Routes
// Real health check — verifies DB connectivity
// ============================================================

import { Hono } from 'hono';
import { checkDbHealth } from '@simplebuildpro/db';

export const healthRoutes = new Hono();

healthRoutes.get('/', async (c) => {
  const dbHealth = await checkDbHealth();

  const status = dbHealth.ok ? 200 : 503;

  return c.json({
    status: dbHealth.ok ? 'healthy' : 'degraded',
    version: process.env.APP_VERSION || '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks: {
      database: {
        status: dbHealth.ok ? 'ok' : 'error',
        latencyMs: dbHealth.latencyMs,
        ...(dbHealth.error ? { error: dbHealth.error } : {}),
      },
    },
  }, status);
});

healthRoutes.get('/ready', async (c) => {
  const dbHealth = await checkDbHealth();
  if (!dbHealth.ok) {
    return c.json({ ready: false, reason: 'Database not reachable' }, 503);
  }
  return c.json({ ready: true });
});

healthRoutes.get('/live', (c) => {
  return c.json({ alive: true });
});
