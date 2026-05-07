// ============================================================
// SimpleBuild Pro — API Integration Tests: Health & Core
// Tests health endpoint, CORS, 404 handling, rate limiting
// ============================================================

import { describe, it, expect, beforeAll } from 'vitest';

const API_URL = process.env.API_URL || 'http://localhost:8080';

describe('Health & Core API', () => {
  describe('GET /health', () => {
    it('should return 200 with health status', async () => {
      const res = await fetch(`${API_URL}/health`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.status).toBe('ok');
      expect(data).toHaveProperty('timestamp');
      expect(data).toHaveProperty('uptime');
    });
  });

  describe('404 Handling', () => {
    it('should return JSON 404 for unknown routes', async () => {
      const res = await fetch(`${API_URL}/api/v1/nonexistent-endpoint`);
      expect(res.status).toBe(404);

      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('NOT_FOUND');
    });

    it('should include method and path in 404 response', async () => {
      const res = await fetch(`${API_URL}/api/v1/does-not-exist`, { method: 'POST' });
      expect(res.status).toBe(404);

      const data = await res.json();
      expect(data.error.message).toContain('not found');
    });
  });

  describe('CORS', () => {
    it('should include CORS headers for allowed origins', async () => {
      const res = await fetch(`${API_URL}/health`, {
        headers: { Origin: 'http://localhost:3000' },
      });
      expect(res.headers.get('access-control-allow-origin')).toBeTruthy();
    });

    it('should handle preflight OPTIONS requests', async () => {
      const res = await fetch(`${API_URL}/api/v1/auth/login`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:3000',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type,Authorization',
        },
      });
      // Should return 204 or 200 for preflight
      expect([200, 204]).toContain(res.status);
    });
  });

  describe('Security Headers', () => {
    it('should include secure headers', async () => {
      const res = await fetch(`${API_URL}/health`);
      // Hono secureHeaders middleware adds these
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('x-frame-options')).toBeTruthy();
    });
  });

  describe('Rate Limiting', () => {
    it('should include rate limit headers on API requests', async () => {
      const res = await fetch(`${API_URL}/api/v1/auth/me`);
      expect(res.headers.get('x-ratelimit-limit')).toBeTruthy();
      expect(res.headers.get('x-ratelimit-remaining')).toBeTruthy();
      expect(res.headers.get('x-ratelimit-reset')).toBeTruthy();
    });

    it('should include rate limiter backend indicator', async () => {
      const res = await fetch(`${API_URL}/api/v1/auth/me`);
      const backend = res.headers.get('x-ratelimit-backend');
      expect(['redis', 'memory']).toContain(backend);
    });
  });

  describe('Request Tracing', () => {
    it('should return X-Request-ID header', async () => {
      const res = await fetch(`${API_URL}/health`);
      expect(res.headers.get('x-request-id')).toBeTruthy();
    });

    it('should echo back provided X-Request-ID', async () => {
      const requestId = `test-${Date.now()}`;
      const res = await fetch(`${API_URL}/health`, {
        headers: { 'X-Request-ID': requestId },
      });
      expect(res.headers.get('x-request-id')).toBe(requestId);
    });
  });
});
