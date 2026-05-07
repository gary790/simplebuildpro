// ============================================================
// SimpleBuild Pro — Global Error Handler
// ============================================================

import type { ErrorHandler } from 'hono';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errorHandler: ErrorHandler = (err, c) => {
  console.error(`[ERROR] ${err.message}`, {
    path: c.req.path,
    method: c.req.method,
    stack: err.stack,
  });

  if (err instanceof AppError) {
    return c.json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details && process.env.NODE_ENV !== 'production' ? { details: err.details } : {}),
      },
    }, err.statusCode as any);
  }

  // Catch Zod validation errors
  if (err.name === 'ZodError') {
    return c.json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed.',
        details: process.env.NODE_ENV !== 'production' ? (err as any).issues : undefined,
      },
    }, 400);
  }

  // Generic 500
  return c.json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred.'
        : err.message,
    },
  }, 500);
};
