// ============================================================
// SimpleBuild Pro — API Integration Tests: Authentication
// Tests signup, login, token refresh, profile, password change
// ============================================================

import { describe, it, expect, beforeAll } from 'vitest';

const API_URL = process.env.API_URL || 'http://localhost:8080';

const TEST_USER = {
  email: `api-test-${Date.now()}@test.simplebuildpro.com`,
  password: 'SecureTestPass123!',
  name: 'API Test User',
};

let accessToken = '';
let refreshToken = '';

async function api(path: string, options: RequestInit = {}) {
  const url = `${API_URL}/api/v1${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (accessToken && !headers.Authorization) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  return fetch(url, { ...options, headers });
}

describe('Auth API', () => {
  describe('POST /auth/signup', () => {
    it('should create a new user and return tokens', async () => {
      const res = await api('/auth/signup', {
        method: 'POST',
        body: JSON.stringify(TEST_USER),
      });
      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('accessToken');
      expect(data.data).toHaveProperty('refreshToken');
      expect(data.data).toHaveProperty('user');
      expect(data.data.user.email).toBe(TEST_USER.email);
      expect(data.data.user.name).toBe(TEST_USER.name);
      expect(data.data.user.plan).toBe('free');

      accessToken = data.data.accessToken;
      refreshToken = data.data.refreshToken;
    });

    it('should reject duplicate email', async () => {
      const res = await api('/auth/signup', {
        method: 'POST',
        body: JSON.stringify(TEST_USER),
      });
      expect(res.status).toBe(409);

      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toMatch(/DUPLICATE|EXISTS|CONFLICT/i);
    });

    it('should validate required fields', async () => {
      const res = await api('/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email: 'missing@fields.com' }),
      });
      expect([400, 422]).toContain(res.status);
    });

    it('should reject invalid email format', async () => {
      const res = await api('/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email: 'not-an-email', password: 'test1234', name: 'Test' }),
      });
      expect([400, 422]).toContain(res.status);
    });
  });

  describe('POST /auth/login', () => {
    it('should authenticate with valid credentials', async () => {
      const res = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: TEST_USER.email,
          password: TEST_USER.password,
        }),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.accessToken).toBeTruthy();
      expect(data.data.refreshToken).toBeTruthy();

      accessToken = data.data.accessToken;
      refreshToken = data.data.refreshToken;
    });

    it('should reject invalid password', async () => {
      const res = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: TEST_USER.email,
          password: 'WrongPassword!',
        }),
      });
      expect(res.status).toBe(401);

      const data = await res.json();
      expect(data.success).toBe(false);
    });

    it('should reject non-existent user', async () => {
      const res = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'nonexistent@test.com',
          password: 'anypassword',
        }),
      });
      expect([401, 404]).toContain(res.status);
    });
  });

  describe('GET /auth/me', () => {
    it('should return user profile with valid token', async () => {
      const res = await api('/auth/me');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.email).toBe(TEST_USER.email);
      expect(data.data.name).toBe(TEST_USER.name);
      expect(data.data).not.toHaveProperty('passwordHash');
    });

    it('should reject request without token', async () => {
      const res = await api('/auth/me', {
        headers: { Authorization: '' },
      });
      expect(res.status).toBe(401);
    });

    it('should reject request with invalid token', async () => {
      const res = await api('/auth/me', {
        headers: { Authorization: 'Bearer invalid-token-here' },
      });
      expect(res.status).toBe(401);
    });
  });

  describe('PATCH /auth/me', () => {
    it('should update user profile', async () => {
      const res = await api('/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Updated Name' }),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.data.name).toBe('Updated Name');
    });

    it('should update avatar URL', async () => {
      const res = await api('/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({ avatarUrl: 'https://example.com/avatar.jpg' }),
      });
      expect(res.status).toBe(200);
    });
  });

  describe('POST /auth/refresh', () => {
    it('should issue new tokens with valid refresh token', async () => {
      const res = await api('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.data.accessToken).toBeTruthy();
      expect(data.data.refreshToken).toBeTruthy();

      accessToken = data.data.accessToken;
      refreshToken = data.data.refreshToken;
    });

    it('should reject expired/invalid refresh token', async () => {
      const res = await api('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: 'invalid-refresh-token' }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /auth/change-password', () => {
    it('should change password with correct current password', async () => {
      const res = await api('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: TEST_USER.password,
          newPassword: 'NewSecurePass456!',
        }),
      });
      expect(res.status).toBe(200);

      // Login with new password
      const loginRes = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: TEST_USER.email,
          password: 'NewSecurePass456!',
        }),
      });
      expect(loginRes.status).toBe(200);

      const loginData = await loginRes.json();
      accessToken = loginData.data.accessToken;
      refreshToken = loginData.data.refreshToken;
    });

    it('should reject incorrect current password', async () => {
      const res = await api('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: 'WrongCurrentPass!',
          newPassword: 'AnotherPass789!',
        }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('should revoke all tokens', async () => {
      const res = await api('/auth/logout', { method: 'POST' });
      expect(res.status).toBe(200);
    });
  });
});
