// ============================================================
// SimpleBuild Pro — Compression & Caching Middleware
// Response compression (gzip/deflate) + ETag + Cache-Control
// Optimized for Cloud Run → Load Balancer → CDN pipeline
// ============================================================

import { createMiddleware } from 'hono/factory';
import { createHash } from 'crypto';
import { gzipSync, deflateSync } from 'zlib';

// ─── ETag + Cache-Control Middleware ─────────────────────────────────────────
// Adds proper cache headers for API responses
export const cacheControl = createMiddleware(async (c, next) => {
  await next();

  const path = c.req.path;
  const method = c.req.method;

  // Only cache GET requests
  if (method !== 'GET') return;

  // Skip if cache headers already set
  if (c.res.headers.get('Cache-Control')) return;

  // Determine cache strategy based on path
  if (path.startsWith('/health')) {
    c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  } else if (path.startsWith('/api/v1/projects') && !path.includes('/files/')) {
    // Project listings — short cache, revalidate
    c.header('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
  } else if (path.startsWith('/api/v1/admin')) {
    // Admin data — slightly longer cache
    c.header('Cache-Control', 'private, max-age=60, stale-while-revalidate=120');
  } else if (path.startsWith('/api/v1/billing')) {
    // Billing — never cache
    c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  } else if (path.startsWith('/api/v1/ai')) {
    // AI responses — no cache (streaming)
    c.header('Cache-Control', 'no-cache, no-store');
  } else if (path.match(/\.(js|css|png|jpg|jpeg|gif|svg|woff2?|ttf|ico)$/)) {
    // Static assets — long cache with immutable
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    // Default API responses — short private cache
    c.header('Cache-Control', 'private, max-age=10, stale-while-revalidate=30');
  }
});

// ─── ETag Generation Middleware ──────────────────────────────────────────────
// Generates weak ETags for JSON responses to enable 304 Not Modified
export const etagMiddleware = createMiddleware(async (c, next) => {
  await next();

  // Only for GET requests with JSON responses
  if (c.req.method !== 'GET') return;

  const contentType = c.res.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) return;

  // Skip streaming responses
  if (c.res.headers.get('Transfer-Encoding') === 'chunked') return;
  if (c.res.headers.get('Content-Type')?.includes('text/event-stream')) return;

  try {
    // Clone the response to read body
    const cloned = c.res.clone();
    const body = await cloned.text();

    if (!body || body.length === 0) return;

    // Generate weak ETag from content hash
    const hash = createHash('md5').update(body).digest('hex').slice(0, 16);
    const etag = `W/"${hash}"`;

    c.header('ETag', etag);

    // Check If-None-Match header
    const ifNoneMatch = c.req.header('If-None-Match');
    if (ifNoneMatch && ifNoneMatch === etag) {
      // Return 304 Not Modified
      c.res = new Response(null, {
        status: 304,
        headers: {
          ETag: etag,
          'Cache-Control': c.res.headers.get('Cache-Control') || '',
        },
      });
    }
  } catch {
    // Silently skip ETag generation on error
  }
});

// ─── Response Compression Middleware ─────────────────────────────────────────
// Note: Cloud Run's load balancer handles compression for external traffic,
// but this ensures compression for direct access and adds Vary header
export const compressionMiddleware = createMiddleware(async (c, next) => {
  await next();

  // Skip if already compressed
  if (c.res.headers.get('Content-Encoding')) return;

  // Skip non-compressible responses
  const contentType = c.res.headers.get('Content-Type') || '';
  const compressible =
    contentType.includes('text/') ||
    contentType.includes('application/json') ||
    contentType.includes('application/javascript') ||
    contentType.includes('application/xml') ||
    contentType.includes('image/svg+xml');

  if (!compressible) return;

  // Skip small responses (< 1KB, compression overhead not worth it)
  const contentLength = c.res.headers.get('Content-Length');
  if (contentLength && parseInt(contentLength) < 1024) return;

  // Skip streaming responses
  if (c.res.headers.get('Transfer-Encoding') === 'chunked') return;
  if (contentType.includes('text/event-stream')) return;

  // Check Accept-Encoding
  const acceptEncoding = c.req.header('Accept-Encoding') || '';

  // Always add Vary header for CDN correctness
  c.header('Vary', 'Accept-Encoding');

  try {
    const body = await c.res.clone().arrayBuffer();
    const buffer = Buffer.from(body);

    // Skip if body is too small after reading
    if (buffer.length < 1024) return;

    if (acceptEncoding.includes('gzip')) {
      const compressed = gzipSync(buffer, { level: 6 });

      // Only use compression if it actually saves space
      if (compressed.length < buffer.length * 0.9) {
        c.res = new Response(compressed, {
          status: c.res.status,
          headers: c.res.headers,
        });
        c.header('Content-Encoding', 'gzip');
        c.header('Content-Length', String(compressed.length));
      }
    } else if (acceptEncoding.includes('deflate')) {
      const compressed = deflateSync(buffer, { level: 6 });

      if (compressed.length < buffer.length * 0.9) {
        c.res = new Response(compressed, {
          status: c.res.status,
          headers: c.res.headers,
        });
        c.header('Content-Encoding', 'deflate');
        c.header('Content-Length', String(compressed.length));
      }
    }
  } catch {
    // Silently skip compression on error — serve uncompressed
  }
});
