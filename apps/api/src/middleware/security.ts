// ============================================================
// SimpleBuild Pro — Security Headers Middleware
// CSP, HSTS, X-Frame-Options, X-Content-Type-Options, etc.
// ============================================================

import { createMiddleware } from 'hono/factory';

/**
 * Security headers middleware for all responses.
 * Implements OWASP recommended headers.
 */
export const customSecurityHeaders = createMiddleware(async (c, next) => {
  await next();

  // Strict Transport Security (1 year, include subdomains, preload)
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');

  // Prevent MIME type sniffing
  c.header('X-Content-Type-Options', 'nosniff');

  // Prevent clickjacking (allow same-origin framing only)
  c.header('X-Frame-Options', 'SAMEORIGIN');

  // XSS Protection (legacy browsers)
  c.header('X-XSS-Protection', '1; mode=block');

  // Referrer Policy
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions Policy (disable unnecessary browser features)
  c.header(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(self), usb=()',
  );

  // Content Security Policy (API — restrictive)
  // Note: This is for the API. The frontend (Next.js) manages its own CSP.
  c.header(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'; form-action 'self'; base-uri 'self'",
  );

  // Prevent DNS prefetching
  c.header('X-DNS-Prefetch-Control', 'off');

  // Cross-Origin headers for API isolation
  c.header('Cross-Origin-Opener-Policy', 'same-origin');
  c.header('Cross-Origin-Resource-Policy', 'same-origin');
});

/**
 * CSRF protection for state-changing requests.
 * Validates Origin/Referer header matches allowed origins.
 */
export const csrfProtection = createMiddleware(async (c, next) => {
  const method = c.req.method.toUpperCase();

  // Only check state-changing methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return next();
  }

  // Skip CSRF for webhook endpoints (they use their own auth)
  const path = c.req.path;
  if (path.includes('/webhook') || path.includes('/internal/')) {
    return next();
  }

  const origin = c.req.header('origin');
  const referer = c.req.header('referer');

  const allowedOrigins = [
    'https://app.simplebuildpro.com',
    'https://www.simplebuildpro.com',
    'https://simplebuildpro.com',
    'https://api.simplebuildpro.com',
  ];

  // In development, also allow localhost
  if (process.env.NODE_ENV !== 'production') {
    allowedOrigins.push('http://localhost:3000', 'http://localhost:3001', 'http://localhost:8080');
  }

  // Check Origin header first (preferred)
  if (origin) {
    if (!allowedOrigins.includes(origin)) {
      return c.json(
        { success: false, error: { code: 'CSRF_REJECTED', message: 'Origin not allowed' } },
        403,
      );
    }
    return next();
  }

  // Fallback to Referer header
  if (referer) {
    const refererOrigin = new URL(referer).origin;
    if (!allowedOrigins.includes(refererOrigin)) {
      return c.json(
        { success: false, error: { code: 'CSRF_REJECTED', message: 'Referer not allowed' } },
        403,
      );
    }
    return next();
  }

  // If neither Origin nor Referer is present, allow (mobile apps, curl, etc.)
  // The JWT auth layer already protects against unauthorized access
  return next();
});
