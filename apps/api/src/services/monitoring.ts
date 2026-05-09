// ============================================================
// SimpleBuild Pro — Performance Monitoring & APM
// Cloud Run compatible: structured logging, tracing, metrics
// ============================================================

import { Context, Next } from 'hono';
import { logger } from './logger';

// ─── Types ────────────────────────────────────────────────────────────────────
interface RequestMetrics {
  method: string;
  path: string;
  statusCode: number;
  latencyMs: number;
  contentLength: number;
  userAgent: string;
  userId?: string;
  traceId: string;
}

interface PerformanceMetrics {
  requests: {
    total: number;
    byStatus: Record<string, number>;
    byMethod: Record<string, number>;
    byPath: Record<string, number>;
  };
  latency: {
    avg: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
  };
  errors: {
    total: number;
    rate: number;
    recent: Array<{ path: string; status: number; error: string; timestamp: string }>;
  };
  uptime: number;
  startTime: string;
}

// ─── In-Memory Metrics Store ──────────────────────────────────────────────────
// For Cloud Run: metrics reset on cold starts (use Cloud Monitoring for persistence)
class MetricsCollector {
  private requestCount = 0;
  private errorCount = 0;
  private latencies: number[] = [];
  private statusCounts: Record<string, number> = {};
  private methodCounts: Record<string, number> = {};
  private pathCounts: Record<string, number> = {};
  private recentErrors: Array<{ path: string; status: number; error: string; timestamp: string }> =
    [];
  private readonly startTime = new Date();
  private readonly MAX_LATENCIES = 10000; // Keep last 10k for percentile calculations
  private readonly MAX_ERRORS = 50;

  record(metrics: RequestMetrics): void {
    this.requestCount++;

    // Track latency
    this.latencies.push(metrics.latencyMs);
    if (this.latencies.length > this.MAX_LATENCIES) {
      this.latencies = this.latencies.slice(-this.MAX_LATENCIES);
    }

    // Track status codes
    const statusGroup = `${Math.floor(metrics.statusCode / 100)}xx`;
    this.statusCounts[statusGroup] = (this.statusCounts[statusGroup] || 0) + 1;

    // Track methods
    this.methodCounts[metrics.method] = (this.methodCounts[metrics.method] || 0) + 1;

    // Track paths (normalize to avoid cardinality explosion)
    const normalizedPath = normalizePath(metrics.path);
    this.pathCounts[normalizedPath] = (this.pathCounts[normalizedPath] || 0) + 1;

    // Track errors
    if (metrics.statusCode >= 400) {
      this.errorCount++;
      this.recentErrors.push({
        path: metrics.path,
        status: metrics.statusCode,
        error: `HTTP ${metrics.statusCode}`,
        timestamp: new Date().toISOString(),
      });
      if (this.recentErrors.length > this.MAX_ERRORS) {
        this.recentErrors.shift();
      }
    }

    // Emit structured log for Cloud Logging
    if (metrics.statusCode >= 500) {
      logger.error('Server error', {
        httpRequest: {
          requestMethod: metrics.method,
          requestUrl: metrics.path,
          status: metrics.statusCode,
          latency: `${metrics.latencyMs / 1000}s`,
          userAgent: metrics.userAgent,
        },
        traceId: metrics.traceId,
        userId: metrics.userId,
      });
    }
  }

  getMetrics(): PerformanceMetrics {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const uptimeSeconds = (Date.now() - this.startTime.getTime()) / 1000;

    return {
      requests: {
        total: this.requestCount,
        byStatus: { ...this.statusCounts },
        byMethod: { ...this.methodCounts },
        byPath: getTopN(this.pathCounts, 20),
      },
      latency: {
        avg: sorted.length > 0 ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : 0,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
        max: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
      },
      errors: {
        total: this.errorCount,
        rate:
          this.requestCount > 0
            ? Math.round((this.errorCount / this.requestCount) * 10000) / 100
            : 0,
        recent: this.recentErrors.slice(-10),
      },
      uptime: uptimeSeconds,
      startTime: this.startTime.toISOString(),
    };
  }

  reset(): void {
    this.requestCount = 0;
    this.errorCount = 0;
    this.latencies = [];
    this.statusCounts = {};
    this.methodCounts = {};
    this.pathCounts = {};
    this.recentErrors = [];
  }
}

// ─── Singleton Metrics Instance ───────────────────────────────────────────────
export const metricsCollector = new MetricsCollector();

// ─── APM Middleware ───────────────────────────────────────────────────────────
export function apmMiddleware() {
  return async (c: Context, next: Next) => {
    const start = performance.now();
    const traceId =
      c.req.header('x-cloud-trace-context')?.split('/')[0] ||
      c.req.header('x-request-id') ||
      generateTraceId();

    // Set trace context for downstream use
    c.set('traceId', traceId);
    c.header('X-Trace-Id', traceId);

    try {
      await next();
    } finally {
      const latencyMs = Math.round(performance.now() - start);
      const statusCode = c.res.status;

      // Record metrics
      metricsCollector.record({
        method: c.req.method,
        path: c.req.path,
        statusCode,
        latencyMs,
        contentLength: parseInt(c.res.headers.get('content-length') || '0'),
        userAgent: c.req.header('user-agent') || 'unknown',
        userId: c.get('userId'),
        traceId,
      });

      // Add server timing header
      c.header('Server-Timing', `total;dur=${latencyMs}`);

      // Structured log in Cloud Logging format
      const logEntry = {
        severity: statusCode >= 500 ? 'ERROR' : statusCode >= 400 ? 'WARNING' : 'INFO',
        httpRequest: {
          requestMethod: c.req.method,
          requestUrl: c.req.url,
          status: statusCode,
          latency: `${latencyMs / 1000}s`,
          userAgent: c.req.header('user-agent'),
          remoteIp: c.req.header('x-forwarded-for') || c.req.header('cf-connecting-ip'),
          protocol: c.req.header('x-forwarded-proto') || 'https',
        },
        'logging.googleapis.com/trace': `projects/simplebuildpro/traces/${traceId}`,
        'logging.googleapis.com/spanId': generateSpanId(),
      };

      // Only log slow requests (>1s) or errors in production
      if (process.env.NODE_ENV === 'production') {
        if (latencyMs > 1000 || statusCode >= 400) {
          console.log(JSON.stringify(logEntry));
        }
      } else {
        // In dev, log all requests
        const color = statusCode >= 500 ? '🔴' : statusCode >= 400 ? '🟡' : '🟢';
        console.log(`${color} ${c.req.method} ${c.req.path} → ${statusCode} (${latencyMs}ms)`);
      }
    }
  };
}

// ─── Metrics API Route Handler ────────────────────────────────────────────────
export function getMetricsHandler() {
  return (c: Context) => {
    const metrics = metricsCollector.getMetrics();
    return c.json(metrics);
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function normalizePath(path: string): string {
  // Replace UUIDs and numeric IDs with placeholders
  return path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d+/g, '/:id')
    .split('?')[0]; // Remove query params
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function getTopN(counts: Record<string, number>, n: number): Record<string, number> {
  return Object.fromEntries(
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n),
  );
}

function generateTraceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function generateSpanId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
