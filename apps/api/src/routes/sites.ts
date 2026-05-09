// ============================================================
// SimpleBuild Pro — Sites Serving Route
// Serves deployed user sites from GCS via Cloud Run
// Handles *.sites.simplebuildpro.com requests
// ============================================================

import { Hono } from 'hono';
import { getDb } from '@simplebuildpro/db';
import { deployments, projects } from '@simplebuildpro/db';
import { eq, and } from 'drizzle-orm';
import { getStorageService } from '../services/storage';
import { GCS_BUCKET_DEPLOYS, SITES_DOMAIN } from '@simplebuildpro/shared';

export const sitesRoutes = new Hono();

// MIME type mapping
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.map': 'application/json',
};

function getMimeType(path: string): string {
  const ext = '.' + path.split('.').pop()?.toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

// ─── Serve Site Files ────────────────────────────────────────
// This catches ALL requests to *.sites.simplebuildpro.com
sitesRoutes.all('/*', async (c) => {
  const host = c.req.header('host') || '';

  // Extract slug from hostname: {slug}.sites.simplebuildpro.com
  const sitesMatch = host.match(/^([^.]+)\.sites\./i) || host.match(/^([^.]+)\./i);
  if (!sitesMatch) {
    return c.json({ error: 'Invalid site hostname' }, 400);
  }

  const slug = sitesMatch[1].toLowerCase();
  let path = c.req.path;

  // Default to index.html for root or directory paths
  if (path === '/' || path.endsWith('/')) {
    path = path + 'index.html';
  }

  // Remove leading slash
  const filePath = path.startsWith('/') ? path.slice(1) : path;
  const gcsPath = `sites/${slug}/${filePath}`;

  try {
    const storage = getStorageService();
    const content = await storage.download(GCS_BUCKET_DEPLOYS, gcsPath);

    const mimeType = getMimeType(filePath);

    return new Response(content, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err: any) {
    // If file not found, try with .html extension (clean URLs)
    if (err.code === 404 || err.message?.includes('No such object') || err.code === 'ENOENT') {
      // Try with .html extension for clean URLs
      if (!filePath.includes('.')) {
        try {
          const storage = getStorageService();
          const htmlContent = await storage.download(
            GCS_BUCKET_DEPLOYS,
            `sites/${slug}/${filePath}.html`,
          );
          return new Response(htmlContent, {
            status: 200,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'public, max-age=3600, s-maxage=86400',
            },
          });
        } catch {
          // Fall through to 404
        }
      }

      // Try serving 404.html if it exists
      try {
        const storage = getStorageService();
        const notFoundContent = await storage.download(
          GCS_BUCKET_DEPLOYS,
          `sites/${slug}/404.html`,
        );
        return new Response(notFoundContent, {
          status: 404,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache',
          },
        });
      } catch {
        // Default 404
      }

      return c.html(
        `
        <!DOCTYPE html>
        <html>
        <head><title>404 - Not Found</title></head>
        <body style="font-family: system-ui; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f8fafc;">
          <div style="text-align: center;">
            <h1 style="font-size: 4rem; margin: 0; color: #1e293b;">404</h1>
            <p style="color: #64748b; margin-top: 1rem;">Page not found</p>
            <p style="color: #94a3b8; font-size: 0.875rem;">Powered by <a href="https://simplebuildpro.com" style="color: #3b82f6;">SimpleBuild Pro</a></p>
          </div>
        </body>
        </html>
      `,
        404,
      );
    }

    // Other errors
    console.error(`[Sites] Error serving ${gcsPath}:`, err.message);
    return c.html(
      `
      <!DOCTYPE html>
      <html>
      <head><title>500 - Server Error</title></head>
      <body style="font-family: system-ui; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f8fafc;">
        <div style="text-align: center;">
          <h1 style="font-size: 4rem; margin: 0; color: #1e293b;">500</h1>
          <p style="color: #64748b; margin-top: 1rem;">Something went wrong</p>
        </div>
      </body>
      </html>
    `,
      500,
    );
  }
});
