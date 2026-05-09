// ============================================================
// SimpleBuild Pro — Request Logger Middleware
// Structured request/response logging with Cloud Logging format
// ============================================================

import type { MiddlewareHandler } from 'hono';
import { logger } from '../services/logger';

export function requestLogger(): MiddlewareHandler {
  return async (c, next) => {
    const start = Date.now();
    const requestId = c.req.header('x-request-id') || crypto.randomUUID();
    const method = c.req.method;
    const url = c.req.path;
    const userAgent = c.req.header('user-agent') || '';
    const remoteIp =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      c.req.header('x-real-ip') ||
      'unknown';

    // Set request ID header for tracing
    c.header('X-Request-ID', requestId);

    try {
      await next();
    } catch (err) {
      // Log uncaught errors
      logger.error(`Unhandled error on ${method} ${url}`, err as Error, { requestId });
      throw err;
    }

    const latencyMs = Date.now() - start;
    const status = c.res.status;
    const userId = c.get('userId' as any) as string | undefined;

    // Log the request
    logger.request(method, url, status, latencyMs, {
      userId,
      requestId,
      userAgent,
      remoteIp,
    });
  };
}
