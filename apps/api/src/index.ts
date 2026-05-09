// ============================================================
// SimpleBuild Pro — API Server
// Production Hono server with real endpoints
// Hosted on Google Cloud Run
// ============================================================

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { timing } from 'hono/timing';

import { authRoutes } from './routes/auth';
import { oauthRoutes } from './routes/oauth';
import { projectRoutes } from './routes/projects';
import { fileRoutes } from './routes/files';
import { assetRoutes } from './routes/assets';
import { aiRoutes } from './routes/ai';
import { buildRoutes } from './routes/build';
import { deployRoutes } from './routes/deploy';
import { billingRoutes, billingWebhookRoute } from './routes/billing';
import { healthRoutes } from './routes/health';
import { orgRoutes } from './routes/organizations';
import { mfaRoutes } from './routes/mfa';
import { adminRoutes } from './routes/admin';
import { sitesRoutes } from './routes/sites';
import { integrationsRoutes, oauthConnectRoutes } from './routes/integrations';
import { errorHandler } from './middleware/error-handler';
import { rateLimiter } from './middleware/rate-limiter';
import { requestLogger } from './middleware/request-logger';
import { customSecurityHeaders, csrfProtection } from './middleware/security';
import { logger } from './services/logger';
import { apmMiddleware, metricsCollector } from './services/monitoring';

const app = new Hono();

// ─── Global Middleware ───────────────────────────────────────
app.use('*', timing());
app.use('*', apmMiddleware());
app.use('*', requestLogger());
app.use('*', secureHeaders());
app.use('*', customSecurityHeaders);
app.use('*', csrfProtection);
app.use(
  '*',
  cors({
    origin: [
      'https://simplebuildpro.com',
      'https://www.simplebuildpro.com',
      'https://app.simplebuildpro.com',
      ...(process.env.NODE_ENV !== 'production'
        ? ['http://localhost:3000', 'http://localhost:3001']
        : []),
    ],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    exposeHeaders: [
      'X-Request-ID',
      'X-Response-Time',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
    ],
    credentials: true,
    maxAge: 86400,
  }),
);
app.use('/api/*', rateLimiter('api'));

// ─── Route Registration ─────────────────────────────────────
app.route('/api/v1/auth', authRoutes);
app.route('/api/v1/oauth', oauthRoutes);
app.route('/api/v1/projects', projectRoutes);
app.route('/api/v1/files', fileRoutes);
app.route('/api/v1/assets', assetRoutes);
app.route('/api/v1/ai', aiRoutes);
app.route('/api/v1/build', buildRoutes);
app.route('/api/v1/deploy', deployRoutes);
app.route('/api/v1/billing', billingRoutes);
app.route('/api/v1/billing', billingWebhookRoute); // Stripe webhook (no auth)
app.route('/api/v1/organizations', orgRoutes);
app.route('/api/v1/mfa', mfaRoutes);
app.route('/api/v1/admin', adminRoutes);
app.route('/api/v1/projects', integrationsRoutes); // Ship panel: integrations, github push, cf deploy, export
app.route('/api/v1/connect', oauthConnectRoutes); // Public OAuth popup flow (no auth middleware)
app.route('/health', healthRoutes);

// ─── Sites Serving (*.sites.simplebuildpro.com via host header) ──
// This middleware checks if the request is for a deployed site
// and routes it to the sites handler before API routes
app.use('*', async (c, next) => {
  const host = c.req.header('host') || '';
  if (host.includes('.sites.') || host.includes('.sites.simplebuildpro.com')) {
    // Route to sites handler
    return sitesRoutes.fetch(c.req.raw, c.env);
  }
  return next();
});

// ─── Internal Metrics (protected) ────────────────────────────
app.get('/internal/metrics', (c) => {
  const authHeader = c.req.header('Authorization');
  const internalToken = process.env.INTERNAL_METRICS_TOKEN;
  if (internalToken && authHeader !== `Bearer ${internalToken}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return c.json(metricsCollector.getMetrics());
});

// ─── Error Handler ───────────────────────────────────────────
app.onError(errorHandler);

// ─── 404 ─────────────────────────────────────────────────────
app.notFound((c) => {
  return c.json(
    {
      success: false,
      error: { code: 'NOT_FOUND', message: `Route ${c.req.method} ${c.req.path} not found` },
    },
    404,
  );
});

// ─── Server Startup ──────────────────────────────────────────
const port = parseInt(process.env.PORT || '8080', 10);

serve({ fetch: app.fetch, port }, (info) => {
  logger.info(`SimpleBuild Pro API started`, {
    port: info.port,
    env: process.env.NODE_ENV || 'development',
    health: `http://localhost:${info.port}/health`,
    api: `http://localhost:${info.port}/api/v1`,
  });

  console.log(`
  ┌──────────────────────────────────────────┐
  │        SimpleBuild Pro API Server         │
  │                                           │
  │  Port:    ${info.port}                         │
  │  Env:     ${(process.env.NODE_ENV || 'development').padEnd(26)}│
  │  Health:  http://localhost:${info.port}/health    │
  │  API:     http://localhost:${info.port}/api/v1    │
  │                                           │
  │  Routes:  auth, oauth, projects, files,   │
  │           assets, ai, build, deploy,      │
  │           billing, orgs, mfa, admin,      │
  │           integrations, health            │
  └──────────────────────────────────────────┘
  `);
});

export default app;
