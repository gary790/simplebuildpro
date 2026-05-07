// ============================================================
// SimpleBuild Pro — Error Tracking & Alerting Service
// Integrates with Cloud Error Reporting and custom alerting
// ============================================================

import { logger } from './logger';

// ─── Error Categories ─────────────────────────────────────────────────────────
export enum ErrorCategory {
  AUTHENTICATION = 'AUTHENTICATION',
  AUTHORIZATION = 'AUTHORIZATION',
  VALIDATION = 'VALIDATION',
  DATABASE = 'DATABASE',
  EXTERNAL_SERVICE = 'EXTERNAL_SERVICE',
  RATE_LIMIT = 'RATE_LIMIT',
  INTERNAL = 'INTERNAL',
  BILLING = 'BILLING',
}

// ─── Error Severity ───────────────────────────────────────────────────────────
export enum ErrorSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

// ─── Structured Error ─────────────────────────────────────────────────────────
export interface TrackedError {
  id: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  message: string;
  stack?: string;
  context: {
    userId?: string;
    path?: string;
    method?: string;
    traceId?: string;
    metadata?: Record<string, any>;
  };
  timestamp: string;
  resolved: boolean;
}

// ─── Error Tracker ────────────────────────────────────────────────────────────
class ErrorTracker {
  private errors: TrackedError[] = [];
  private readonly MAX_ERRORS = 500;
  private errorCounts: Record<string, number> = {};

  track(
    error: Error | string,
    category: ErrorCategory,
    severity: ErrorSeverity,
    context?: TrackedError['context']
  ): TrackedError {
    const tracked: TrackedError = {
      id: generateErrorId(),
      category,
      severity,
      message: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
      context: context || {},
      timestamp: new Date().toISOString(),
      resolved: false,
    };

    this.errors.push(tracked);
    if (this.errors.length > this.MAX_ERRORS) {
      this.errors = this.errors.slice(-this.MAX_ERRORS);
    }

    // Increment category counter
    this.errorCounts[category] = (this.errorCounts[category] || 0) + 1;

    // Log in Cloud Error Reporting format
    const reportedError = {
      '@type': 'type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent',
      message: tracked.stack || tracked.message,
      context: {
        httpRequest: context?.path ? {
          method: context.method || 'UNKNOWN',
          url: context.path,
        } : undefined,
        user: context?.userId,
        reportLocation: {
          functionName: category,
        },
      },
      serviceContext: {
        service: 'simplebuildpro-api',
        version: process.env.APP_VERSION || '1.0.0',
      },
    };

    if (severity === ErrorSeverity.CRITICAL || severity === ErrorSeverity.HIGH) {
      logger.critical(tracked.message, {
        errorId: tracked.id,
        category,
        severity,
        ...context,
        cloudErrorReport: reportedError,
      });
    } else {
      logger.error(tracked.message, {
        errorId: tracked.id,
        category,
        severity,
        ...context,
      });
    }

    return tracked;
  }

  getRecent(limit = 20): TrackedError[] {
    return this.errors.slice(-limit).reverse();
  }

  getByCatogory(category: ErrorCategory): TrackedError[] {
    return this.errors.filter(e => e.category === category);
  }

  getCounts(): Record<string, number> {
    return { ...this.errorCounts };
  }

  getSummary() {
    const last24h = this.errors.filter(
      e => new Date(e.timestamp).getTime() > Date.now() - 86400000
    );

    return {
      total: this.errors.length,
      last24h: last24h.length,
      bySeverity: {
        critical: last24h.filter(e => e.severity === ErrorSeverity.CRITICAL).length,
        high: last24h.filter(e => e.severity === ErrorSeverity.HIGH).length,
        medium: last24h.filter(e => e.severity === ErrorSeverity.MEDIUM).length,
        low: last24h.filter(e => e.severity === ErrorSeverity.LOW).length,
      },
      byCategory: this.errorCounts,
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────
export const errorTracker = new ErrorTracker();

// ─── Helper ───────────────────────────────────────────────────────────────────
function generateErrorId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `err_${Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')}`;
}

// ─── Convenience Methods ──────────────────────────────────────────────────────
export function trackDatabaseError(error: Error, context?: TrackedError['context']) {
  return errorTracker.track(error, ErrorCategory.DATABASE, ErrorSeverity.HIGH, context);
}

export function trackAuthError(error: Error | string, context?: TrackedError['context']) {
  return errorTracker.track(error, ErrorCategory.AUTHENTICATION, ErrorSeverity.MEDIUM, context);
}

export function trackExternalServiceError(error: Error, context?: TrackedError['context']) {
  return errorTracker.track(error, ErrorCategory.EXTERNAL_SERVICE, ErrorSeverity.HIGH, context);
}

export function trackValidationError(error: Error | string, context?: TrackedError['context']) {
  return errorTracker.track(error, ErrorCategory.VALIDATION, ErrorSeverity.LOW, context);
}

export function trackBillingError(error: Error, context?: TrackedError['context']) {
  return errorTracker.track(error, ErrorCategory.BILLING, ErrorSeverity.CRITICAL, context);
}
