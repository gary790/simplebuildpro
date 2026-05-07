// ============================================================
// SimpleBuild Pro — Structured Logger
// JSON structured logging for Cloud Run + Cloud Logging
// Supports correlation IDs, request tracing, and severity levels
// ============================================================

export type LogLevel = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

interface LogEntry {
  severity: LogLevel;
  message: string;
  timestamp: string;
  service: string;
  environment: string;
  traceId?: string;
  spanId?: string;
  userId?: string;
  requestId?: string;
  httpRequest?: {
    method: string;
    url: string;
    status?: number;
    latencyMs?: number;
    userAgent?: string;
    remoteIp?: string;
  };
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };
  metadata?: Record<string, unknown>;
}

const SERVICE_NAME = 'simplebuildpro-api';
const ENVIRONMENT = process.env.NODE_ENV || 'development';
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARNING: 2,
  ERROR: 3,
  CRITICAL: 4,
};

const MIN_LOG_LEVEL: LogLevel = ENVIRONMENT === 'production' ? 'INFO' : 'DEBUG';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[MIN_LOG_LEVEL];
}

function formatEntry(entry: LogEntry): string {
  if (ENVIRONMENT === 'production') {
    // JSON format for Cloud Logging
    return JSON.stringify(entry);
  }
  // Human-readable for local dev
  const prefix = `[${entry.severity}]`;
  const ts = new Date(entry.timestamp).toLocaleTimeString();
  const extra = entry.httpRequest
    ? ` ${entry.httpRequest.method} ${entry.httpRequest.url} ${entry.httpRequest.status || ''} ${entry.httpRequest.latencyMs ? entry.httpRequest.latencyMs + 'ms' : ''}`
    : '';
  const userId = entry.userId ? ` user=${entry.userId.slice(0, 8)}` : '';
  return `${ts} ${prefix} ${entry.message}${extra}${userId}`;
}

function log(level: LogLevel, message: string, extra?: Partial<LogEntry>) {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    severity: level,
    message,
    timestamp: new Date().toISOString(),
    service: SERVICE_NAME,
    environment: ENVIRONMENT,
    ...extra,
  };

  const formatted = formatEntry(entry);

  switch (level) {
    case 'ERROR':
    case 'CRITICAL':
      console.error(formatted);
      break;
    case 'WARNING':
      console.warn(formatted);
      break;
    default:
      console.log(formatted);
  }
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) =>
    log('DEBUG', message, { metadata: meta }),

  info: (message: string, meta?: Record<string, unknown>) =>
    log('INFO', message, { metadata: meta }),

  warn: (message: string, meta?: Record<string, unknown>) =>
    log('WARNING', message, { metadata: meta }),

  error: (message: string, error?: Error | unknown, meta?: Record<string, unknown>) => {
    const errorInfo = error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : error
        ? { name: 'UnknownError', message: String(error) }
        : undefined;
    log('ERROR', message, { error: errorInfo, metadata: meta });
  },

  critical: (message: string, error?: Error | unknown, meta?: Record<string, unknown>) => {
    const errorInfo = error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : undefined;
    log('CRITICAL', message, { error: errorInfo, metadata: meta });
  },

  request: (
    method: string,
    url: string,
    status: number,
    latencyMs: number,
    extra?: { userId?: string; requestId?: string; userAgent?: string; remoteIp?: string },
  ) => {
    const level: LogLevel = status >= 500 ? 'ERROR' : status >= 400 ? 'WARNING' : 'INFO';
    log(level, `${method} ${url} ${status} ${latencyMs}ms`, {
      userId: extra?.userId,
      requestId: extra?.requestId,
      httpRequest: {
        method,
        url,
        status,
        latencyMs,
        userAgent: extra?.userAgent,
        remoteIp: extra?.remoteIp,
      },
    });
  },

  audit: (
    action: string,
    userId: string,
    resourceType: string,
    resourceId?: string,
    meta?: Record<string, unknown>,
  ) => {
    log('INFO', `AUDIT: ${action} on ${resourceType}${resourceId ? `:${resourceId}` : ''}`, {
      userId,
      metadata: { action, resourceType, resourceId, ...meta },
    });
  },
};

export default logger;
