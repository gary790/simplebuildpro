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
import { previewRoutes } from './routes/preview';
import { buildRoutes } from './routes/build';
import { deployRoutes } from './routes/deploy';
import { billingRoutes } from './routes/billing';
import { healthRoutes } from './routes/health';
import { orgRoutes } from './routes/organizations';
import { mfaRoutes } from './routes/mfa';
import { adminRoutes } from './routes/admin';
import { errorHandler } from './middleware/error-handler';
import { rateLimiter } from './middleware/rate-limiter';
import { requestLogger } from './middleware/request-logger';
import { logger } from './services/logger';

const app = new Hono();

// ─── Global Middleware ───────────────────────────────────────
app.use('*', timing());
app.use('*', requestLogger());
app.use('*', secureHeaders());
app.use('*', cors({
  origin: [
    'https://simplebuildpro.com',
    'https://www.simplebuildpro.com',
    'https://app.simplebuildpro.com',
    ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:3000', 'http://localhost:3001'] : []),
  ],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  exposeHeaders: ['X-Request-ID', 'X-Response-Time', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  credentials: true,
  maxAge: 86400,
}));
app.use('/api/*', rateLimiter('api'));

// ─── Route Registration ─────────────────────────────────────
app.route('/api/v1/auth', authRoutes);
app.route('/api/v1/oauth', oauthRoutes);
app.route('/api/v1/projects', projectRoutes);
app.route('/api/v1/files', fileRoutes);
app.route('/api/v1/assets', assetRoutes);
app.route('/api/v1/ai', aiRoutes);
app.route('/api/v1/preview', previewRoutes);
app.route('/api/v1/build', buildRoutes);
app.route('/api/v1/deploy', deployRoutes);
app.route('/api/v1/billing', billingRoutes);
app.route('/api/v1/organizations', orgRoutes);
app.route('/api/v1/mfa', mfaRoutes);
app.route('/api/v1/admin', adminRoutes);
app.route('/health', healthRoutes);

// ─── Error Handler ───────────────────────────────────────────
app.onError(errorHandler);

// ─── 404 ─────────────────────────────────────────────────────
app.notFound((c) => {
  return c.json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Route ${c.req.method} ${c.req.path} not found` },
  }, 404);
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
  │           assets, ai, preview, build,     │
  │           deploy, billing, orgs, mfa,     │
  │           admin, health                   │
  └──────────────────────────────────────────┘
  `);
});

export default app;
