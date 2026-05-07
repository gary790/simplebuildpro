// ============================================================
// SimpleBuild Pro — API Integration Tests: Projects & Files
// Tests CRUD for projects, files, builds, deployments
// ============================================================

import { describe, it, expect, beforeAll } from 'vitest';

const API_URL = process.env.API_URL || 'http://localhost:8080';

let accessToken = '';
let projectId = '';

async function api(path: string, options: RequestInit = {}) {
  const url = `${API_URL}/api/v1${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  return fetch(url, { ...options, headers });
}

// Helper: create a test user and get token
async function setupAuth() {
  const email = `proj-test-${Date.now()}@test.simplebuildpro.com`;
  const res = await api('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password: 'TestPass123!', name: 'Project Tester' }),
  });
  const data = await res.json();
  accessToken = data.data?.accessToken || '';
}

describe('Projects API', () => {
  beforeAll(async () => {
    await setupAuth();
  });

  describe('POST /projects', () => {
    it('should create a new project', async () => {
      const res = await api('/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Test Project',
          slug: `test-project-${Date.now()}`,
          description: 'A project for testing',
        }),
      });
      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.name).toBe('Test Project');
      expect(data.data).toHaveProperty('id');
      expect(data.data.status).toBe('draft');

      projectId = data.data.id;
    });

    it('should reject project with duplicate slug for same user', async () => {
      const slug = `dup-slug-${Date.now()}`;
      await api('/projects', {
        method: 'POST',
        body: JSON.stringify({ name: 'First', slug }),
      });

      const res = await api('/projects', {
        method: 'POST',
        body: JSON.stringify({ name: 'Second', slug }),
      });
      expect([400, 409]).toContain(res.status);
    });

    it('should reject unauthenticated requests', async () => {
      const res = await fetch(`${API_URL}/api/v1/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Unauth', slug: 'unauth' }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /projects', () => {
    it('should list user projects', async () => {
      const res = await api('/projects');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data.length).toBeGreaterThan(0);
    });
  });

  describe('GET /projects/:id', () => {
    it('should return project details', async () => {
      const res = await api(`/projects/${projectId}`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.data.id).toBe(projectId);
      expect(data.data.name).toBe('Test Project');
    });

    it('should return 404 for non-existent project', async () => {
      const res = await api('/projects/00000000-0000-0000-0000-000000000000');
      expect([403, 404]).toContain(res.status);
    });
  });

  describe('PATCH /projects/:id', () => {
    it('should update project name and description', async () => {
      const res = await api(`/projects/${projectId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Updated Project', description: 'Updated desc' }),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.data.name).toBe('Updated Project');
    });
  });
});

describe('Files API', () => {
  describe('POST /files (upsert)', () => {
    it('should create a new file in project', async () => {
      const res = await api(`/files`, {
        method: 'POST',
        body: JSON.stringify({
          projectId,
          path: 'index.html',
          content: '<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Hello</h1></body></html>',
        }),
      });
      expect([200, 201]).toContain(res.status);

      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it('should update existing file content', async () => {
      const res = await api(`/files`, {
        method: 'POST',
        body: JSON.stringify({
          projectId,
          path: 'index.html',
          content: '<!DOCTYPE html><html><head><title>Updated</title></head><body><h1>Updated</h1></body></html>',
        }),
      });
      expect([200, 201]).toContain(res.status);
    });

    it('should create CSS file', async () => {
      const res = await api(`/files`, {
        method: 'POST',
        body: JSON.stringify({
          projectId,
          path: 'styles.css',
          content: 'body { font-family: sans-serif; margin: 0; padding: 20px; }',
        }),
      });
      expect([200, 201]).toContain(res.status);
    });
  });

  describe('GET /files', () => {
    it('should list project files', async () => {
      const res = await api(`/files?projectId=${projectId}`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('POST /files/bulk-upsert', () => {
    it('should bulk upsert multiple files', async () => {
      const res = await api(`/files/bulk-upsert`, {
        method: 'POST',
        body: JSON.stringify({
          projectId,
          files: {
            'script.js': 'console.log("hello");',
            'about.html': '<!DOCTYPE html><html><body><h1>About</h1></body></html>',
          },
        }),
      });
      expect([200, 201]).toContain(res.status);
    });
  });
});

describe('Build API', () => {
  describe('POST /build', () => {
    it('should build the project', async () => {
      const res = await api('/build', {
        method: 'POST',
        body: JSON.stringify({ projectId }),
      });
      // Build may succeed or fail depending on project content
      expect([200, 201, 400]).toContain(res.status);

      if (res.status === 200 || res.status === 201) {
        const data = await res.json();
        expect(data.data).toHaveProperty('versionNumber');
        expect(data.data).toHaveProperty('files');
        expect(data.data).toHaveProperty('durationMs');
      }
    });
  });

  describe('GET /build/versions', () => {
    it('should list project versions', async () => {
      const res = await api(`/build/versions?projectId=${projectId}`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
    });
  });
});

describe('Organizations API', () => {
  let orgId = '';

  describe('POST /organizations', () => {
    it('should create an organization', async () => {
      const res = await api('/organizations', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Test Org',
          slug: `test-org-${Date.now()}`,
        }),
      });
      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.data.name).toBe('Test Org');
      orgId = data.data.id;
    });

    it('should reject duplicate slug', async () => {
      const slug = `dup-org-${Date.now()}`;
      await api('/organizations', {
        method: 'POST',
        body: JSON.stringify({ name: 'First Org', slug }),
      });

      const res = await api('/organizations', {
        method: 'POST',
        body: JSON.stringify({ name: 'Second Org', slug }),
      });
      expect([400, 409]).toContain(res.status);
    });
  });

  describe('GET /organizations/:id', () => {
    it('should return organization details', async () => {
      if (!orgId) return;
      const res = await api(`/organizations/${orgId}`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.data.name).toBe('Test Org');
    });
  });

  describe('GET /organizations/:id/members', () => {
    it('should list organization members', async () => {
      if (!orgId) return;
      const res = await api(`/organizations/${orgId}/members`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data.length).toBeGreaterThan(0);
      expect(data.data[0].role).toBe('owner');
    });
  });

  describe('POST /organizations/:id/invitations', () => {
    it('should create an invitation', async () => {
      if (!orgId) return;
      const res = await api(`/organizations/${orgId}/invitations`, {
        method: 'POST',
        body: JSON.stringify({
          email: 'invited@test.simplebuildpro.com',
          role: 'editor',
        }),
      });
      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.data.email).toBe('invited@test.simplebuildpro.com');
      expect(data.data.role).toBe('editor');
      expect(data.data).toHaveProperty('inviteUrl');
    });
  });

  describe('GET /organizations/:id/invitations', () => {
    it('should list pending invitations', async () => {
      if (!orgId) return;
      const res = await api(`/organizations/${orgId}/invitations`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
    });
  });
});

describe('Admin API', () => {
  it('should reject non-admin users', async () => {
    const res = await api('/admin/overview');
    // Free plan users should get 403
    expect(res.status).toBe(403);
  });
});

describe('MFA API', () => {
  describe('GET /mfa/status', () => {
    it('should return MFA status', async () => {
      const res = await api('/mfa/status');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.data).toHaveProperty('enabled');
      expect(data.data.enabled).toBe(false);
    });
  });

  describe('POST /mfa/setup', () => {
    it('should return QR code and secret', async () => {
      const res = await api('/mfa/setup', { method: 'POST' });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.data).toHaveProperty('secret');
      expect(data.data).toHaveProperty('otpauthUrl');
      expect(data.data).toHaveProperty('qrCodeUrl');
      expect(data.data.otpauthUrl).toContain('otpauth://totp/');
    });
  });
});

describe('Project Cleanup', () => {
  it('should delete test project', async () => {
    if (!projectId) return;
    const res = await api(`/projects/${projectId}`, { method: 'DELETE' });
    expect([200, 204]).toContain(res.status);
  });
});
