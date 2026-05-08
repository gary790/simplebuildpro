// ============================================================
// SimpleBuild Pro — Integrations Routes (Ship Panel v2)
// OAuth connections, token storage, GitHub/Cloudflare/Vercel/Netlify
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import crypto from 'crypto';
import { getDb } from '@simplebuildpro/db';
import { projects, projectFiles, userConnections, projectIntegrations, projectEnvVars } from '@simplebuildpro/db';
import { eq, and } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import { requireAuth, type AuthEnv } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import { logger } from '../services/logger';

export const integrationsRoutes = new Hono<AuthEnv>();
integrationsRoutes.use('*', requireAuth);

// ─── Public OAuth routes (no requireAuth — browser navigations) ──
// These handle the OAuth redirect flow initiated from popup windows.
// The token is passed as a query parameter since browser navigations
// cannot send Authorization headers.
export const oauthConnectRoutes = new Hono();

const JWT_SECRET = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is required');
  return secret;
};

/** Verify a Bearer token from query param and return userId */
function verifyTokenFromQuery(token: string | undefined): string {
  if (!token) {
    throw new AppError(401, 'MISSING_TOKEN', 'OAuth connect requires a valid token.');
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET()) as { sub: string };
    return payload.sub;
  } catch {
    throw new AppError(401, 'INVALID_TOKEN', 'Invalid or expired token.');
  }
}

/** Build state string: randomHex:userId:projectId */
function buildOAuthState(userId: string, projectId?: string): string {
  const rand = crypto.randomBytes(16).toString('hex');
  return projectId ? `${rand}:${userId}:${projectId}` : `${rand}:${userId}`;
}

/** Parse state string back to { userId, projectId } */
function parseOAuthState(state: string): { userId: string; projectId?: string } {
  const parts = state.split(':');
  return { userId: parts[1], projectId: parts[2] || undefined };
}

/** Render a tiny HTML page that sends postMessage to opener and closes the popup */
function oauthPopupResult(provider: string, success: boolean, errorMsg?: string): Response {
  const data = JSON.stringify({ provider, success, error: errorMsg || null });
  const html = `<!DOCTYPE html>
<html><head><title>Connecting...</title></head>
<body>
<script>
  if (window.opener) {
    window.opener.postMessage({ type: 'oauth-connect-result', data: ${data} }, '*');
  }
  window.close();
  // Fallback if popup blocker prevents close
  document.body.innerHTML = '<p style="font-family:system-ui;text-align:center;margin-top:40vh">' +
    (${JSON.stringify(success)} ? 'Connected! You can close this window.' : 'Connection failed. You can close this window.') + '</p>';
</script>
</body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
}

// ─── Config ─────────────────────────────────────────────────
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const VERCEL_CLIENT_ID = process.env.VERCEL_CLIENT_ID || '';
const VERCEL_CLIENT_SECRET = process.env.VERCEL_CLIENT_SECRET || '';
const NETLIFY_CLIENT_ID = process.env.NETLIFY_CLIENT_ID || '';
const NETLIFY_CLIENT_SECRET = process.env.NETLIFY_CLIENT_SECRET || '';
const API_URL = process.env.API_URL || 'http://localhost:8080';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

// Simple encryption for stored tokens (AES-256-GCM)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');

function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const key = Buffer.from(ENCRYPTION_KEY.slice(0, 64), 'hex');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(encryptedText: string): string {
  try {
    const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
    if (!ivHex || !authTagHex || !encrypted) return encryptedText; // Not encrypted
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const key = Buffer.from(ENCRYPTION_KEY.slice(0, 64), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return encryptedText; // Return as-is if decryption fails
  }
}

// ─── Helper: verify project ownership ───────────────────────
async function getOwnedProject(userId: string, projectId: string) {
  const db = getDb();
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, userId)),
  });
  if (!project) {
    throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');
  }
  return project;
}

// ═══════════════════════════════════════════════════════════════
// USER CONNECTIONS — Account-level OAuth connections
// ═══════════════════════════════════════════════════════════════

// ─── GET /connections — List user's connected accounts ──────
integrationsRoutes.get('/connections', async (c) => {
  const session = c.get('session');
  const db = getDb();

  const connections = await db.query.userConnections.findMany({
    where: eq(userConnections.userId, session.userId),
  });

  return c.json({
    success: true,
    data: connections.map(conn => ({
      id: conn.id,
      provider: conn.provider,
      displayName: conn.displayName,
      accountId: conn.accountId,
      metadata: conn.metadata,
      connectedAt: conn.connectedAt.toISOString(),
      hasToken: !!conn.accessToken,
    })),
  });
});

// ─── DELETE /connections/:provider — Disconnect ──────────────
integrationsRoutes.delete('/connections/:provider', async (c) => {
  const session = c.get('session');
  const provider = c.req.param('provider');
  const db = getDb();

  await db.delete(userConnections)
    .where(and(eq(userConnections.userId, session.userId), eq(userConnections.provider, provider)));

  return c.json({ success: true, data: { message: `${provider} disconnected.` } });
});

// ═══════════════════════════════════════════════════════════════
// GITHUB OAUTH — Connect with repo scope
// ═══════════════════════════════════════════════════════════════

// Step 1: Redirect to GitHub OAuth with repo scope
// (kept for backward compat — requires auth via Bearer header)
integrationsRoutes.get('/connect/github', async (c) => {
  const session = c.get('session');

  if (!GITHUB_CLIENT_ID) {
    throw new AppError(503, 'GITHUB_NOT_CONFIGURED', 'GitHub OAuth not configured.');
  }

  const state = buildOAuthState(session.userId);
  const redirectUri = `${API_URL}/api/v1/connect/github/callback`;

  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'repo read:user user:email',
    state,
  });

  return c.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

// Legacy callback kept for backward compat — redirects to dashboard
integrationsRoutes.get('/connect/github/callback', async (c) => {
  return c.redirect(`${APP_URL}/dashboard?error=use_popup_flow`);
});

// ─── GET /connect/github/repos — List user's repos ──────────
integrationsRoutes.get('/connect/github/repos', async (c) => {
  const session = c.get('session');
  const db = getDb();

  const connection = await db.query.userConnections.findFirst({
    where: and(eq(userConnections.userId, session.userId), eq(userConnections.provider, 'github_repo')),
  });

  if (!connection?.accessToken) {
    throw new AppError(401, 'GITHUB_NOT_CONNECTED', 'Connect your GitHub account first.');
  }

  const token = decrypt(connection.accessToken);
  const page = parseInt(c.req.query('page') || '1');
  const perPage = 30;

  const res = await fetch(`https://api.github.com/user/repos?sort=updated&per_page=${perPage}&page=${page}&affiliation=owner,collaborator,organization_member`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'SimpleBuildPro',
    },
  });

  if (!res.ok) {
    throw new AppError(502, 'GITHUB_API_ERROR', 'Failed to fetch repos from GitHub.');
  }

  const repos = await res.json() as any[];

  return c.json({
    success: true,
    data: repos.map((r: any) => ({
      id: r.id,
      name: r.name,
      fullName: r.full_name,
      owner: r.owner.login,
      private: r.private,
      defaultBranch: r.default_branch,
      description: r.description,
      updatedAt: r.updated_at,
      htmlUrl: r.html_url,
    })),
  });
});

// ═══════════════════════════════════════════════════════════════
// VERCEL OAUTH — Connect
// ═══════════════════════════════════════════════════════════════

integrationsRoutes.get('/connect/vercel', async (c) => {
  const session = c.get('session');
  if (!VERCEL_CLIENT_ID) throw new AppError(503, 'VERCEL_NOT_CONFIGURED', 'Vercel not configured.');
  const state = buildOAuthState(session.userId);
  const redirectUri = `${API_URL}/api/v1/connect/vercel/callback`;
  const params = new URLSearchParams({ client_id: VERCEL_CLIENT_ID, redirect_uri: redirectUri, state });
  return c.redirect(`https://vercel.com/integrations/new?${params}`);
});

integrationsRoutes.get('/connect/vercel/callback', async (c) => {
  return c.redirect(`${APP_URL}/dashboard?error=use_popup_flow`);
});

// ═══════════════════════════════════════════════════════════════
// NETLIFY OAUTH — Connect
// ═══════════════════════════════════════════════════════════════

integrationsRoutes.get('/connect/netlify', async (c) => {
  const session = c.get('session');
  if (!NETLIFY_CLIENT_ID) throw new AppError(503, 'NETLIFY_NOT_CONFIGURED', 'Netlify not configured.');
  const state = buildOAuthState(session.userId);
  const redirectUri = `${API_URL}/api/v1/connect/netlify/callback`;
  const params = new URLSearchParams({ client_id: NETLIFY_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', state });
  return c.redirect(`https://app.netlify.com/authorize?${params}`);
});

integrationsRoutes.get('/connect/netlify/callback', async (c) => {
  return c.redirect(`${APP_URL}/dashboard?error=use_popup_flow`);
});

// ═══════════════════════════════════════════════════════════════
// CLOUDFLARE — User pastes a scoped API token (no OAuth)
// ═══════════════════════════════════════════════════════════════

const cloudflareConnectSchema = z.object({
  apiToken: z.string().min(10),
  accountId: z.string().optional(),
});

integrationsRoutes.post('/connect/cloudflare', async (c) => {
  const session = c.get('session');
  const body = await c.req.json();
  const { apiToken, accountId } = cloudflareConnectSchema.parse(body);

  // Validate the token by making a test request
  const verifyRes = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  const verifyData = await verifyRes.json() as any;

  if (!verifyData.success || verifyData.result?.status !== 'active') {
    throw new AppError(400, 'INVALID_TOKEN', 'Cloudflare API token is invalid or inactive. Please check and try again.');
  }

  // Get account info if no account ID provided
  let resolvedAccountId = accountId;
  if (!resolvedAccountId) {
    const accountsRes = await fetch('https://api.cloudflare.com/client/v4/accounts?page=1&per_page=5', {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    const accountsData = await accountsRes.json() as any;
    if (accountsData.success && accountsData.result?.length > 0) {
      resolvedAccountId = accountsData.result[0].id;
    }
  }

  const db = getDb();
  const existing = await db.query.userConnections.findFirst({
    where: and(eq(userConnections.userId, session.userId), eq(userConnections.provider, 'cloudflare')),
  });

  const connectionData = {
    userId: session.userId,
    provider: 'cloudflare',
    displayName: resolvedAccountId ? `Account ${resolvedAccountId.slice(0, 8)}...` : 'Cloudflare',
    accessToken: encrypt(apiToken),
    refreshToken: null,
    tokenExpiresAt: null,
    accountId: resolvedAccountId || null,
    metadata: {
      tokenStatus: 'active',
      verifiedAt: new Date().toISOString(),
    },
    updatedAt: new Date(),
  };

  if (existing) {
    await db.update(userConnections).set(connectionData).where(eq(userConnections.id, existing.id));
  } else {
    await db.insert(userConnections).values({ ...connectionData, connectedAt: new Date() });
  }

  logger.info(`Cloudflare connected: account ${resolvedAccountId} (user ${session.userId})`);

  return c.json({
    success: true,
    data: { message: 'Cloudflare connected.', accountId: resolvedAccountId },
  });
});

// ═══════════════════════════════════════════════════════════════
// SUPABASE — User pastes project URL + keys
// ═══════════════════════════════════════════════════════════════

const supabaseConnectSchema = z.object({
  projectUrl: z.string().url(),
  anonKey: z.string().min(10),
  serviceRoleKey: z.string().optional(),
});

integrationsRoutes.post('/connect/supabase', async (c) => {
  const session = c.get('session');
  const body = await c.req.json();
  const { projectUrl, anonKey, serviceRoleKey } = supabaseConnectSchema.parse(body);

  // Validate by pinging the Supabase health endpoint
  try {
    const healthRes = await fetch(`${projectUrl}/rest/v1/`, {
      headers: { apikey: anonKey },
    });
    if (!healthRes.ok && healthRes.status !== 404) {
      throw new AppError(400, 'SUPABASE_INVALID', 'Could not connect to Supabase project. Check URL and keys.');
    }
  } catch (err: any) {
    if (err instanceof AppError) throw err;
    throw new AppError(400, 'SUPABASE_INVALID', `Connection failed: ${err.message}`);
  }

  const db = getDb();
  const existing = await db.query.userConnections.findFirst({
    where: and(eq(userConnections.userId, session.userId), eq(userConnections.provider, 'supabase')),
  });

  // Extract project ref from URL
  const projectRef = projectUrl.replace('https://', '').split('.')[0];

  const connectionData = {
    userId: session.userId,
    provider: 'supabase',
    displayName: projectRef,
    accessToken: encrypt(anonKey),
    refreshToken: serviceRoleKey ? encrypt(serviceRoleKey) : null,
    tokenExpiresAt: null,
    accountId: projectRef,
    metadata: {
      projectUrl,
      hasServiceRole: !!serviceRoleKey,
    },
    updatedAt: new Date(),
  };

  if (existing) {
    await db.update(userConnections).set(connectionData).where(eq(userConnections.id, existing.id));
  } else {
    await db.insert(userConnections).values({ ...connectionData, connectedAt: new Date() });
  }

  return c.json({ success: true, data: { message: 'Supabase connected.', projectRef } });
});

// ═══════════════════════════════════════════════════════════════
// PROJECT INTEGRATIONS — Per-project settings
// ═══════════════════════════════════════════════════════════════

// ─── GET /projects/:id/integrations — Get project integration configs
integrationsRoutes.get('/:id/integrations', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('id');
  await getOwnedProject(session.userId, projectId);

  const db = getDb();

  const integrations = await db.query.projectIntegrations.findMany({
    where: eq(projectIntegrations.projectId, projectId),
  });

  // Also get user's connections for display
  const connections = await db.query.userConnections.findMany({
    where: eq(userConnections.userId, session.userId),
  });

  return c.json({
    success: true,
    data: {
      integrations: integrations.map(i => ({
        id: i.id,
        provider: i.provider,
        connectionId: i.connectionId,
        config: i.config,
        lastActionAt: i.lastActionAt?.toISOString() || null,
        lastActionResult: i.lastActionResult,
      })),
      connections: connections.map(c => ({
        id: c.id,
        provider: c.provider,
        displayName: c.displayName,
        accountId: c.accountId,
        connectedAt: c.connectedAt.toISOString(),
      })),
    },
  });
});

// ─── PUT /projects/:id/integrations/:provider — Save project integration config
const saveProjectIntegrationSchema = z.object({
  connectionId: z.string().uuid().optional(),
  config: z.record(z.unknown()),
});

integrationsRoutes.put('/:id/integrations/:provider', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('id');
  const provider = c.req.param('provider');
  await getOwnedProject(session.userId, projectId);

  const body = await c.req.json();
  const { connectionId, config } = saveProjectIntegrationSchema.parse(body);

  const db = getDb();

  const existing = await db.query.projectIntegrations.findFirst({
    where: and(eq(projectIntegrations.projectId, projectId), eq(projectIntegrations.provider, provider)),
  });

  if (existing) {
    await db.update(projectIntegrations).set({
      connectionId: connectionId || existing.connectionId,
      config,
      updatedAt: new Date(),
    }).where(eq(projectIntegrations.id, existing.id));
  } else {
    await db.insert(projectIntegrations).values({
      projectId,
      provider,
      connectionId: connectionId || null,
      config,
    });
  }

  return c.json({ success: true, data: { message: 'Integration saved.' } });
});

// ─── DELETE /projects/:id/integrations/:provider — Remove
integrationsRoutes.delete('/:id/integrations/:provider', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('id');
  const provider = c.req.param('provider');
  await getOwnedProject(session.userId, projectId);

  const db = getDb();
  await db.delete(projectIntegrations)
    .where(and(eq(projectIntegrations.projectId, projectId), eq(projectIntegrations.provider, provider)));

  return c.json({ success: true, data: { message: 'Integration removed.' } });
});

// ═══════════════════════════════════════════════════════════════
// ACTIONS — Push to GitHub, Deploy to Cloudflare/Vercel/Netlify
// ═══════════════════════════════════════════════════════════════

// ─── POST /projects/:id/github/push ─────────────────────────
const githubPushSchema = z.object({
  repo: z.string().min(1), // "owner/repo"
  branch: z.string().default('main'),
  commitMessage: z.string().default('Update from SimpleBuild Pro Studio'),
});

integrationsRoutes.post('/:id/github/push', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('id');
  await getOwnedProject(session.userId, projectId);

  const body = await c.req.json();
  const { repo, branch, commitMessage } = githubPushSchema.parse(body);

  const db = getDb();

  // Get user's GitHub connection
  const connection = await db.query.userConnections.findFirst({
    where: and(eq(userConnections.userId, session.userId), eq(userConnections.provider, 'github_repo')),
  });

  if (!connection?.accessToken) {
    throw new AppError(401, 'GITHUB_NOT_CONNECTED', 'Connect your GitHub account first.');
  }

  const token = decrypt(connection.accessToken);

  // Get all project files
  const files = await db.query.projectFiles.findMany({
    where: eq(projectFiles.projectId, projectId),
  });

  if (files.length === 0) {
    throw new AppError(400, 'NO_FILES', 'Project has no files to push.');
  }

  const [owner, repoName] = repo.includes('/') ? repo.split('/') : [connection.displayName, repo];
  const apiBase = `https://api.github.com/repos/${owner}/${repoName}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'SimpleBuildPro',
  };

  try {
    // 1. Get latest commit SHA for branch
    let baseSha: string | null = null;
    let baseTreeSha: string | null = null;

    try {
      const refRes = await fetch(`${apiBase}/git/ref/heads/${branch}`, { headers });
      if (refRes.ok) {
        const refData = await refRes.json() as any;
        baseSha = refData.object.sha;
        const commitRes = await fetch(`${apiBase}/git/commits/${baseSha}`, { headers });
        const commitData = await commitRes.json() as any;
        baseTreeSha = commitData.tree.sha;
      }
    } catch { /* Branch doesn't exist — will create */ }

    // 2. Create blobs for each file
    const treeItems: { path: string; mode: string; type: string; sha: string }[] = [];
    for (const file of files) {
      const blobRes = await fetch(`${apiBase}/git/blobs`, {
        method: 'POST', headers,
        body: JSON.stringify({ content: file.content || '', encoding: 'utf-8' }),
      });
      if (!blobRes.ok) {
        const err = await blobRes.json() as any;
        throw new Error(`Blob failed for ${file.path}: ${err.message}`);
      }
      const blobData = await blobRes.json() as any;
      treeItems.push({ path: file.path, mode: '100644', type: 'blob', sha: blobData.sha });
    }

    // 3. Create tree
    const treePayload: Record<string, any> = { tree: treeItems };
    if (baseTreeSha) treePayload.base_tree = baseTreeSha;

    const treeRes = await fetch(`${apiBase}/git/trees`, {
      method: 'POST', headers, body: JSON.stringify(treePayload),
    });
    if (!treeRes.ok) throw new Error('Tree creation failed');
    const treeData = await treeRes.json() as any;

    // 4. Create commit
    const commitPayload: Record<string, any> = { message: commitMessage, tree: treeData.sha };
    if (baseSha) commitPayload.parents = [baseSha];

    const commitRes = await fetch(`${apiBase}/git/commits`, {
      method: 'POST', headers, body: JSON.stringify(commitPayload),
    });
    if (!commitRes.ok) throw new Error('Commit creation failed');
    const commitData = await commitRes.json() as any;

    // 5. Update/create branch ref
    if (baseSha) {
      await fetch(`${apiBase}/git/refs/heads/${branch}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ sha: commitData.sha, force: true }),
      });
    } else {
      await fetch(`${apiBase}/git/refs`, {
        method: 'POST', headers,
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commitData.sha }),
      });
    }

    // 6. Record action
    const existing = await db.query.projectIntegrations.findFirst({
      where: and(eq(projectIntegrations.projectId, projectId), eq(projectIntegrations.provider, 'github')),
    });

    const actionResult = {
      status: 'success',
      commitSha: commitData.sha,
      filesCount: files.length,
      url: `https://github.com/${owner}/${repoName}/tree/${branch}`,
    };

    if (existing) {
      await db.update(projectIntegrations).set({
        lastActionAt: new Date(),
        lastActionResult: actionResult,
        config: { ...(existing.config as any), repo: `${owner}/${repoName}`, branch },
        updatedAt: new Date(),
      }).where(eq(projectIntegrations.id, existing.id));
    } else {
      await db.insert(projectIntegrations).values({
        projectId,
        provider: 'github',
        connectionId: connection.id,
        config: { repo: `${owner}/${repoName}`, branch },
        lastActionAt: new Date(),
        lastActionResult: actionResult,
      });
    }

    logger.info(`GitHub push: ${owner}/${repoName}#${branch} — ${files.length} files`);

    return c.json({ success: true, data: actionResult });
  } catch (err: any) {
    logger.error(`GitHub push failed: ${err.message}`);
    throw new AppError(502, 'GITHUB_PUSH_FAILED', err.message);
  }
});

// ─── POST /projects/:id/cloudflare/deploy ───────────────────
const cfDeploySchema = z.object({
  projectName: z.string().min(1),
});

integrationsRoutes.post('/:id/cloudflare/deploy', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('id');
  await getOwnedProject(session.userId, projectId);

  const body = await c.req.json();
  const { projectName } = cfDeploySchema.parse(body);

  const db = getDb();

  // Get Cloudflare connection
  const connection = await db.query.userConnections.findFirst({
    where: and(eq(userConnections.userId, session.userId), eq(userConnections.provider, 'cloudflare')),
  });

  if (!connection?.accessToken) {
    throw new AppError(401, 'CLOUDFLARE_NOT_CONNECTED', 'Connect your Cloudflare account first.');
  }

  const token = decrypt(connection.accessToken);
  const accountId = connection.accountId;

  if (!accountId) {
    throw new AppError(400, 'NO_ACCOUNT_ID', 'Cloudflare account ID not found. Reconnect your account.');
  }

  // Get project files
  const files = await db.query.projectFiles.findMany({
    where: eq(projectFiles.projectId, projectId),
  });

  if (files.length === 0) {
    throw new AppError(400, 'NO_FILES', 'Project has no files to deploy.');
  }

  const cfHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  try {
    // Ensure project exists
    const checkRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}`,
      { headers: cfHeaders },
    );
    if (!checkRes.ok) {
      const createRes = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`,
        { method: 'POST', headers: cfHeaders, body: JSON.stringify({ name: projectName, production_branch: 'main' }) },
      );
      if (!createRes.ok) {
        const err = await createRes.json() as any;
        throw new Error(`Create project failed: ${JSON.stringify(err.errors)}`);
      }
    }

    // Direct upload deployment
    const formData = new FormData();
    for (const file of files) {
      formData.append(file.path, new Blob([file.content || '']), file.path);
    }

    const deployRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/deployments`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData },
    );

    if (!deployRes.ok) {
      const err = await deployRes.json() as any;
      throw new Error(`Deploy failed: ${JSON.stringify(err.errors)}`);
    }

    const deployData = await deployRes.json() as any;
    const deployUrl = deployData.result?.url || `https://${projectName}.pages.dev`;

    // Record action
    const actionResult = { status: 'success', url: deployUrl, filesCount: files.length };

    const existing = await db.query.projectIntegrations.findFirst({
      where: and(eq(projectIntegrations.projectId, projectId), eq(projectIntegrations.provider, 'cloudflare')),
    });

    if (existing) {
      await db.update(projectIntegrations).set({
        lastActionAt: new Date(), lastActionResult: actionResult,
        config: { ...(existing.config as any), projectName },
        updatedAt: new Date(),
      }).where(eq(projectIntegrations.id, existing.id));
    } else {
      await db.insert(projectIntegrations).values({
        projectId, provider: 'cloudflare', connectionId: connection.id,
        config: { projectName }, lastActionAt: new Date(), lastActionResult: actionResult,
      });
    }

    logger.info(`Cloudflare deploy: ${projectName} — ${files.length} files → ${deployUrl}`);
    return c.json({ success: true, data: actionResult });
  } catch (err: any) {
    logger.error(`Cloudflare deploy failed: ${err.message}`);
    throw new AppError(502, 'CLOUDFLARE_DEPLOY_FAILED', err.message);
  }
});

// ─── POST /projects/:id/vercel/deploy ───────────────────────
const vercelDeploySchema = z.object({
  projectName: z.string().min(1),
});

integrationsRoutes.post('/:id/vercel/deploy', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('id');
  await getOwnedProject(session.userId, projectId);

  const body = await c.req.json();
  const { projectName } = vercelDeploySchema.parse(body);

  const db = getDb();

  const connection = await db.query.userConnections.findFirst({
    where: and(eq(userConnections.userId, session.userId), eq(userConnections.provider, 'vercel')),
  });

  if (!connection?.accessToken) {
    throw new AppError(401, 'VERCEL_NOT_CONNECTED', 'Connect your Vercel account first.');
  }

  const token = decrypt(connection.accessToken);

  const files = await db.query.projectFiles.findMany({
    where: eq(projectFiles.projectId, projectId),
  });

  if (files.length === 0) {
    throw new AppError(400, 'NO_FILES', 'Project has no files to deploy.');
  }

  try {
    // Vercel Deployments API — create deployment with file contents
    const vercelFiles = files.map(f => ({
      file: f.path,
      data: f.content || '',
    }));

    const deployRes = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: projectName,
        files: vercelFiles,
        projectSettings: { framework: null },
        target: 'production',
      }),
    });

    if (!deployRes.ok) {
      const err = await deployRes.json() as any;
      throw new Error(`Vercel deploy failed: ${err.error?.message || JSON.stringify(err)}`);
    }

    const deployData = await deployRes.json() as any;
    const deployUrl = `https://${deployData.url}`;

    const actionResult = { status: 'success', url: deployUrl, filesCount: files.length };

    const existing = await db.query.projectIntegrations.findFirst({
      where: and(eq(projectIntegrations.projectId, projectId), eq(projectIntegrations.provider, 'vercel')),
    });

    if (existing) {
      await db.update(projectIntegrations).set({
        lastActionAt: new Date(), lastActionResult: actionResult,
        config: { ...(existing.config as any), projectName },
        updatedAt: new Date(),
      }).where(eq(projectIntegrations.id, existing.id));
    } else {
      await db.insert(projectIntegrations).values({
        projectId, provider: 'vercel', connectionId: connection.id,
        config: { projectName }, lastActionAt: new Date(), lastActionResult: actionResult,
      });
    }

    logger.info(`Vercel deploy: ${projectName} — ${files.length} files → ${deployUrl}`);
    return c.json({ success: true, data: actionResult });
  } catch (err: any) {
    logger.error(`Vercel deploy failed: ${err.message}`);
    throw new AppError(502, 'VERCEL_DEPLOY_FAILED', err.message);
  }
});

// ─── POST /projects/:id/netlify/deploy ──────────────────────
const netlifyDeploySchema = z.object({
  siteName: z.string().min(1),
});

integrationsRoutes.post('/:id/netlify/deploy', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('id');
  await getOwnedProject(session.userId, projectId);

  const body = await c.req.json();
  const { siteName } = netlifyDeploySchema.parse(body);

  const db = getDb();

  const connection = await db.query.userConnections.findFirst({
    where: and(eq(userConnections.userId, session.userId), eq(userConnections.provider, 'netlify')),
  });

  if (!connection?.accessToken) {
    throw new AppError(401, 'NETLIFY_NOT_CONNECTED', 'Connect your Netlify account first.');
  }

  const token = decrypt(connection.accessToken);

  const files = await db.query.projectFiles.findMany({
    where: eq(projectFiles.projectId, projectId),
  });

  if (files.length === 0) {
    throw new AppError(400, 'NO_FILES', 'Project has no files to deploy.');
  }

  try {
    // Find or create site
    let siteId: string | null = null;
    const sitesRes = await fetch(`https://api.netlify.com/api/v1/sites?name=${siteName}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const sites = await sitesRes.json() as any[];
    const existingSite = sites.find((s: any) => s.name === siteName);

    if (existingSite) {
      siteId = existingSite.id;
    } else {
      const createRes = await fetch('https://api.netlify.com/api/v1/sites', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: siteName }),
      });
      const newSite = await createRes.json() as any;
      siteId = newSite.id;
    }

    if (!siteId) {
      throw new Error('Could not find or create Netlify site');
    }

    // Create a deploy with file digests
    const crypto = await import('crypto');
    const fileDigests: Record<string, string> = {};
    for (const file of files) {
      const hash = crypto.createHash('sha1').update(file.content || '').digest('hex');
      fileDigests[`/${file.path}`] = hash;
    }

    const deployCreateRes = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/deploys`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: fileDigests }),
    });
    const deploy = await deployCreateRes.json() as any;

    // Upload required files
    if (deploy.required?.length > 0) {
      for (const file of files) {
        const hash = crypto.createHash('sha1').update(file.content || '').digest('hex');
        if (deploy.required.includes(hash)) {
          await fetch(`https://api.netlify.com/api/v1/deploys/${deploy.id}/files/${file.path}`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
            body: file.content || '',
          });
        }
      }
    }

    const deployUrl = deploy.ssl_url || deploy.url || `https://${siteName}.netlify.app`;
    const actionResult = { status: 'success', url: deployUrl, filesCount: files.length };

    const existingIntegration = await db.query.projectIntegrations.findFirst({
      where: and(eq(projectIntegrations.projectId, projectId), eq(projectIntegrations.provider, 'netlify')),
    });

    if (existingIntegration) {
      await db.update(projectIntegrations).set({
        lastActionAt: new Date(), lastActionResult: actionResult,
        config: { ...(existingIntegration.config as any), siteName, siteId },
        updatedAt: new Date(),
      }).where(eq(projectIntegrations.id, existingIntegration.id));
    } else {
      await db.insert(projectIntegrations).values({
        projectId, provider: 'netlify', connectionId: connection.id,
        config: { siteName, siteId }, lastActionAt: new Date(), lastActionResult: actionResult,
      });
    }

    logger.info(`Netlify deploy: ${siteName} — ${files.length} files → ${deployUrl}`);
    return c.json({ success: true, data: actionResult });
  } catch (err: any) {
    logger.error(`Netlify deploy failed: ${err.message}`);
    throw new AppError(502, 'NETLIFY_DEPLOY_FAILED', err.message);
  }
});

// ═══════════════════════════════════════════════════════════════
// AWS — User pastes Access Key ID + Secret Access Key
// ═══════════════════════════════════════════════════════════════

const awsConnectSchema = z.object({
  accessKeyId: z.string().min(16).max(128),
  secretAccessKey: z.string().min(16),
  region: z.string().default('us-east-1'),
});

integrationsRoutes.post('/connect/aws', async (c) => {
  const session = c.get('session');
  const body = await c.req.json();
  const { accessKeyId, secretAccessKey, region } = awsConnectSchema.parse(body);

  // Validate by calling STS GetCallerIdentity
  try {
    const stsRes = await awsSignedRequest({
      service: 'sts',
      region,
      accessKeyId,
      secretAccessKey,
      method: 'POST',
      path: '/',
      body: 'Action=GetCallerIdentity&Version=2011-06-15',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (!stsRes.ok) {
      throw new AppError(400, 'AWS_INVALID_CREDENTIALS', 'AWS credentials are invalid. Check your Access Key ID and Secret.');
    }

    const stsText = await stsRes.text();
    // Extract Account ID from XML response
    const accountMatch = stsText.match(/<Account>(\d+)<\/Account>/);
    const arnMatch = stsText.match(/<Arn>([^<]+)<\/Arn>/);
    const awsAccountId = accountMatch?.[1] || '';
    const arn = arnMatch?.[1] || '';

    const db = getDb();
    const existing = await db.query.userConnections.findFirst({
      where: and(eq(userConnections.userId, session.userId), eq(userConnections.provider, 'aws')),
    });

    const connectionData = {
      userId: session.userId,
      provider: 'aws',
      displayName: awsAccountId ? `AWS ${awsAccountId}` : 'AWS',
      accessToken: encrypt(JSON.stringify({ accessKeyId, secretAccessKey })),
      refreshToken: null,
      tokenExpiresAt: null,
      accountId: awsAccountId,
      metadata: {
        region,
        arn,
        verifiedAt: new Date().toISOString(),
      },
      updatedAt: new Date(),
    };

    if (existing) {
      await db.update(userConnections).set(connectionData).where(eq(userConnections.id, existing.id));
    } else {
      await db.insert(userConnections).values({ ...connectionData, connectedAt: new Date() });
    }

    logger.info(`AWS connected: account ${awsAccountId} (user ${session.userId})`);
    return c.json({ success: true, data: { message: 'AWS connected.', accountId: awsAccountId, region } });
  } catch (err: any) {
    if (err instanceof AppError) throw err;
    throw new AppError(400, 'AWS_CONNECT_FAILED', `AWS connection failed: ${err.message}`);
  }
});

// ─── POST /projects/:id/aws/deploy — Deploy to S3 + CloudFront
const awsDeploySchema = z.object({
  bucketName: z.string().min(3).max(63),
  region: z.string().default('us-east-1'),
  distributionId: z.string().optional(), // CloudFront distribution ID for cache invalidation
});

integrationsRoutes.post('/:id/aws/deploy', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('id');
  await getOwnedProject(session.userId, projectId);

  const body = await c.req.json();
  const { bucketName, region, distributionId } = awsDeploySchema.parse(body);

  const db = getDb();

  const connection = await db.query.userConnections.findFirst({
    where: and(eq(userConnections.userId, session.userId), eq(userConnections.provider, 'aws')),
  });

  if (!connection?.accessToken) {
    throw new AppError(401, 'AWS_NOT_CONNECTED', 'Connect your AWS account first.');
  }

  const { accessKeyId, secretAccessKey } = JSON.parse(decrypt(connection.accessToken));

  const files = await db.query.projectFiles.findMany({
    where: eq(projectFiles.projectId, projectId),
  });

  if (files.length === 0) {
    throw new AppError(400, 'NO_FILES', 'Project has no files to deploy.');
  }

  try {
    // Upload each file to S3
    let uploadedCount = 0;
    for (const file of files) {
      const contentType = getS3ContentType(file.path);
      const s3Res = await awsSignedRequest({
        service: 's3',
        region,
        accessKeyId,
        secretAccessKey,
        method: 'PUT',
        path: `/${bucketName}/${file.path}`,
        body: file.content || '',
        headers: {
          'Content-Type': contentType,
          'x-amz-acl': 'public-read',
        },
        host: `${bucketName}.s3.${region}.amazonaws.com`,
      });

      if (!s3Res.ok) {
        const errText = await s3Res.text();
        // If bucket doesn't exist, try to create it
        if (s3Res.status === 404 && uploadedCount === 0) {
          // Create bucket
          const createBody = region === 'us-east-1' ? '' :
            `<CreateBucketConfiguration><LocationConstraint>${region}</LocationConstraint></CreateBucketConfiguration>`;
          const createRes = await awsSignedRequest({
            service: 's3',
            region,
            accessKeyId,
            secretAccessKey,
            method: 'PUT',
            path: `/${bucketName}`,
            body: createBody,
            headers: createBody ? { 'Content-Type': 'application/xml' } : {},
            host: `${bucketName}.s3.${region}.amazonaws.com`,
          });
          if (!createRes.ok) {
            throw new Error(`Bucket creation failed: ${await createRes.text()}`);
          }

          // Configure as static website
          const websiteConfig = `<WebsiteConfiguration><IndexDocument><Suffix>index.html</Suffix></IndexDocument><ErrorDocument><Key>index.html</Key></ErrorDocument></WebsiteConfiguration>`;
          await awsSignedRequest({
            service: 's3',
            region,
            accessKeyId,
            secretAccessKey,
            method: 'PUT',
            path: `/${bucketName}?website`,
            body: websiteConfig,
            headers: { 'Content-Type': 'application/xml' },
            host: `${bucketName}.s3.${region}.amazonaws.com`,
          });

          // Retry the file upload
          const retryRes = await awsSignedRequest({
            service: 's3',
            region,
            accessKeyId,
            secretAccessKey,
            method: 'PUT',
            path: `/${bucketName}/${file.path}`,
            body: file.content || '',
            headers: { 'Content-Type': contentType, 'x-amz-acl': 'public-read' },
            host: `${bucketName}.s3.${region}.amazonaws.com`,
          });
          if (!retryRes.ok) throw new Error(`Upload failed after bucket creation: ${file.path}`);
        } else {
          throw new Error(`S3 upload failed for ${file.path}: ${errText.slice(0, 200)}`);
        }
      }
      uploadedCount++;
    }

    // Invalidate CloudFront cache if distribution provided
    if (distributionId) {
      const invalidationBody = `<InvalidationBatch><Paths><Quantity>1</Quantity><Items><Path>/*</Path></Items></Paths><CallerReference>${Date.now()}</CallerReference></InvalidationBatch>`;
      await awsSignedRequest({
        service: 'cloudfront',
        region: 'us-east-1', // CloudFront is always us-east-1
        accessKeyId,
        secretAccessKey,
        method: 'POST',
        path: `/2020-05-31/distribution/${distributionId}/invalidation`,
        body: invalidationBody,
        headers: { 'Content-Type': 'application/xml' },
      });
    }

    const deployUrl = distributionId
      ? `CloudFront distribution ${distributionId}`
      : `http://${bucketName}.s3-website-${region}.amazonaws.com`;

    const actionResult = { status: 'success', url: deployUrl, filesCount: files.length, bucketName, region };

    // Record action
    const existing = await db.query.projectIntegrations.findFirst({
      where: and(eq(projectIntegrations.projectId, projectId), eq(projectIntegrations.provider, 'aws')),
    });

    if (existing) {
      await db.update(projectIntegrations).set({
        lastActionAt: new Date(), lastActionResult: actionResult,
        config: { ...(existing.config as any), bucketName, region, distributionId },
        updatedAt: new Date(),
      }).where(eq(projectIntegrations.id, existing.id));
    } else {
      await db.insert(projectIntegrations).values({
        projectId, provider: 'aws', connectionId: connection.id,
        config: { bucketName, region, distributionId },
        lastActionAt: new Date(), lastActionResult: actionResult,
      });
    }

    logger.info(`AWS S3 deploy: ${bucketName} (${region}) — ${files.length} files → ${deployUrl}`);
    return c.json({ success: true, data: actionResult });
  } catch (err: any) {
    logger.error(`AWS deploy failed: ${err.message}`);
    throw new AppError(502, 'AWS_DEPLOY_FAILED', err.message);
  }
});

// ═══════════════════════════════════════════════════════════════
// GOOGLE CLOUD — Service Account JSON key or OAuth
// ═══════════════════════════════════════════════════════════════

const gcpConnectSchema = z.object({
  serviceAccountKey: z.string().min(10), // JSON key content
  projectId: z.string().optional(),
});

integrationsRoutes.post('/connect/gcp', async (c) => {
  const session = c.get('session');
  const body = await c.req.json();
  const { serviceAccountKey, projectId: gcpProjectId } = gcpConnectSchema.parse(body);

  try {
    // Parse and validate the service account key
    const keyData = JSON.parse(serviceAccountKey);
    if (!keyData.client_email || !keyData.private_key || !keyData.project_id) {
      throw new AppError(400, 'INVALID_SA_KEY', 'Invalid service account key. Must contain client_email, private_key, and project_id.');
    }

    const resolvedProjectId = gcpProjectId || keyData.project_id;

    // Validate by getting an access token
    const accessToken = await getGcpAccessToken(keyData);
    if (!accessToken) {
      throw new AppError(400, 'GCP_AUTH_FAILED', 'Could not authenticate with the provided service account key.');
    }

    // Verify project access
    const projectRes = await fetch(`https://cloudresourcemanager.googleapis.com/v1/projects/${resolvedProjectId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!projectRes.ok) {
      throw new AppError(400, 'GCP_PROJECT_ACCESS', `Cannot access GCP project "${resolvedProjectId}". Ensure the service account has the required permissions.`);
    }

    const projectData = await projectRes.json() as any;

    const db = getDb();
    const existing = await db.query.userConnections.findFirst({
      where: and(eq(userConnections.userId, session.userId), eq(userConnections.provider, 'gcp')),
    });

    const connectionData = {
      userId: session.userId,
      provider: 'gcp',
      displayName: `${resolvedProjectId} (${keyData.client_email.split('@')[0]})`,
      accessToken: encrypt(serviceAccountKey),
      refreshToken: null,
      tokenExpiresAt: null,
      accountId: resolvedProjectId,
      metadata: {
        projectId: resolvedProjectId,
        projectName: projectData.name,
        clientEmail: keyData.client_email,
        verifiedAt: new Date().toISOString(),
      },
      updatedAt: new Date(),
    };

    if (existing) {
      await db.update(userConnections).set(connectionData).where(eq(userConnections.id, existing.id));
    } else {
      await db.insert(userConnections).values({ ...connectionData, connectedAt: new Date() });
    }

    logger.info(`GCP connected: project ${resolvedProjectId} (user ${session.userId})`);
    return c.json({ success: true, data: { message: 'Google Cloud connected.', projectId: resolvedProjectId } });
  } catch (err: any) {
    if (err instanceof AppError) throw err;
    throw new AppError(400, 'GCP_CONNECT_FAILED', `GCP connection failed: ${err.message}`);
  }
});

// ─── POST /projects/:id/gcp/deploy — Deploy to Firebase Hosting or Cloud Storage
const gcpDeploySchema = z.object({
  target: z.enum(['firebase_hosting', 'cloud_storage']),
  // Firebase Hosting
  siteId: z.string().optional(), // Firebase Hosting site ID
  // Cloud Storage
  bucketName: z.string().optional(),
});

integrationsRoutes.post('/:id/gcp/deploy', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('id');
  await getOwnedProject(session.userId, projectId);

  const body = await c.req.json();
  const { target, siteId, bucketName } = gcpDeploySchema.parse(body);

  const db = getDb();

  const connection = await db.query.userConnections.findFirst({
    where: and(eq(userConnections.userId, session.userId), eq(userConnections.provider, 'gcp')),
  });

  if (!connection?.accessToken) {
    throw new AppError(401, 'GCP_NOT_CONNECTED', 'Connect your Google Cloud account first.');
  }

  const keyData = JSON.parse(decrypt(connection.accessToken));
  const gcpProjectId = connection.accountId || keyData.project_id;

  const files = await db.query.projectFiles.findMany({
    where: eq(projectFiles.projectId, projectId),
  });

  if (files.length === 0) {
    throw new AppError(400, 'NO_FILES', 'Project has no files to deploy.');
  }

  try {
    const accessToken = await getGcpAccessToken(keyData);
    if (!accessToken) throw new Error('Failed to get GCP access token');

    let deployUrl = '';

    if (target === 'firebase_hosting') {
      // ─── Firebase Hosting Deploy ──────────────────────
      const resolvedSiteId = siteId || gcpProjectId;

      // 1. Create a new version
      const versionRes = await fetch(
        `https://firebasehosting.googleapis.com/v1beta1/sites/${resolvedSiteId}/versions`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ config: { rewrites: [{ glob: '**', destination: '/index.html' }] } }),
        }
      );
      if (!versionRes.ok) {
        const err = await versionRes.json() as any;
        throw new Error(`Firebase version creation failed: ${err.error?.message || JSON.stringify(err)}`);
      }
      const versionData = await versionRes.json() as any;
      const versionName = versionData.name; // sites/{siteId}/versions/{versionId}

      // 2. Populate files — get upload URLs
      const fileHashes: Record<string, string> = {};
      for (const file of files) {
        const hash = crypto.createHash('sha256').update(file.content || '').digest('hex');
        fileHashes[`/${file.path}`] = hash;
      }

      const populateRes = await fetch(
        `https://firebasehosting.googleapis.com/v1beta1/${versionName}:populateFiles`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: fileHashes }),
        }
      );
      if (!populateRes.ok) throw new Error('Firebase populateFiles failed');
      const populateData = await populateRes.json() as any;

      // 3. Upload required files
      if (populateData.uploadRequiredHashes?.length > 0 && populateData.uploadUrl) {
        for (const file of files) {
          const hash = crypto.createHash('sha256').update(file.content || '').digest('hex');
          if (populateData.uploadRequiredHashes.includes(hash)) {
            // gzip the content
            const { gzipSync } = await import('zlib');
            const compressed = gzipSync(Buffer.from(file.content || ''));
            await fetch(`${populateData.uploadUrl}/${hash}`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/octet-stream' },
              body: compressed,
            });
          }
        }
      }

      // 4. Finalize the version
      const finalizeRes = await fetch(
        `https://firebasehosting.googleapis.com/v1beta1/${versionName}?update_mask=status`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'FINALIZED' }),
        }
      );
      if (!finalizeRes.ok) throw new Error('Firebase version finalize failed');

      // 5. Release the version
      await fetch(
        `https://firebasehosting.googleapis.com/v1beta1/sites/${resolvedSiteId}/releases?versionName=${versionName}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        }
      );

      deployUrl = `https://${resolvedSiteId}.web.app`;

    } else if (target === 'cloud_storage') {
      // ─── GCS Static Website Deploy ────────────────────
      const resolvedBucket = bucketName || `${gcpProjectId}-website`;

      // Ensure bucket exists
      const bucketCheckRes = await fetch(
        `https://storage.googleapis.com/storage/v1/b/${resolvedBucket}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (!bucketCheckRes.ok) {
        // Create bucket
        const createRes = await fetch(
          `https://storage.googleapis.com/storage/v1/b?project=${gcpProjectId}`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: resolvedBucket,
              website: { mainPageSuffix: 'index.html', notFoundPage: '404.html' },
              iamConfiguration: { uniformBucketLevelAccess: { enabled: true } },
            }),
          }
        );
        if (!createRes.ok) {
          const err = await createRes.json() as any;
          throw new Error(`GCS bucket creation failed: ${err.error?.message}`);
        }

        // Make bucket publicly readable
        await fetch(
          `https://storage.googleapis.com/storage/v1/b/${resolvedBucket}/iam`,
          {
            method: 'PUT',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              bindings: [{ role: 'roles/storage.objectViewer', members: ['allUsers'] }],
            }),
          }
        );
      }

      // Upload files
      for (const file of files) {
        const contentType = getS3ContentType(file.path); // reuse mime helper
        await fetch(
          `https://storage.googleapis.com/upload/storage/v1/b/${resolvedBucket}/o?uploadType=media&name=${encodeURIComponent(file.path)}`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': contentType,
            },
            body: file.content || '',
          }
        );
      }

      deployUrl = `https://storage.googleapis.com/${resolvedBucket}/index.html`;
    }

    const actionResult = { status: 'success', url: deployUrl, filesCount: files.length, target };

    const existing = await db.query.projectIntegrations.findFirst({
      where: and(eq(projectIntegrations.projectId, projectId), eq(projectIntegrations.provider, 'gcp')),
    });

    if (existing) {
      await db.update(projectIntegrations).set({
        lastActionAt: new Date(), lastActionResult: actionResult,
        config: { ...(existing.config as any), target, siteId, bucketName },
        updatedAt: new Date(),
      }).where(eq(projectIntegrations.id, existing.id));
    } else {
      await db.insert(projectIntegrations).values({
        projectId, provider: 'gcp', connectionId: connection.id,
        config: { target, siteId, bucketName },
        lastActionAt: new Date(), lastActionResult: actionResult,
      });
    }

    logger.info(`GCP deploy (${target}): ${deployUrl} — ${files.length} files`);
    return c.json({ success: true, data: actionResult });
  } catch (err: any) {
    logger.error(`GCP deploy failed: ${err.message}`);
    throw new AppError(502, 'GCP_DEPLOY_FAILED', err.message);
  }
});

// ─── AWS Signature V4 helper ─────────────────────────────────
interface AwsRequestOptions {
  service: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  method: string;
  path: string;
  body?: string;
  headers?: Record<string, string>;
  host?: string;
}

async function awsSignedRequest(opts: AwsRequestOptions): Promise<Response> {
  const { service, region, accessKeyId, secretAccessKey, method, path, body = '', headers = {} } = opts;
  const host = opts.host || `${service}.${region}.amazonaws.com`;
  const url = `https://${host}${path}`;

  const now = new Date();
  const dateStamp = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const shortDate = dateStamp.slice(0, 8);

  const payloadHash = crypto.createHash('sha256').update(body).digest('hex');

  const canonicalHeaders: Record<string, string> = {
    host,
    'x-amz-date': dateStamp,
    'x-amz-content-sha256': payloadHash,
    ...headers,
  };

  const signedHeaderKeys = Object.keys(canonicalHeaders).sort();
  const signedHeaders = signedHeaderKeys.join(';');
  const canonicalHeaderStr = signedHeaderKeys.map(k => `${k.toLowerCase()}:${canonicalHeaders[k]}\n`).join('');

  const canonicalRequest = [method, path.split('?')[0], path.includes('?') ? path.split('?')[1] : '',
    canonicalHeaderStr, signedHeaders, payloadHash].join('\n');

  const scope = `${shortDate}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', dateStamp, scope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');

  const kDate = crypto.createHmac('sha256', `AWS4${secretAccessKey}`).update(shortDate).digest();
  const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
  const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
  const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const fetchHeaders: Record<string, string> = {
    ...headers,
    host,
    'x-amz-date': dateStamp,
    'x-amz-content-sha256': payloadHash,
    Authorization: authHeader,
  };

  return fetch(url, { method, headers: fetchHeaders, body: method !== 'GET' ? body : undefined });
}

// ─── GCP JWT + Access Token helper ───────────────────────────
async function getGcpAccessToken(keyData: { client_email: string; private_key: string }): Promise<string | null> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: keyData.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })).toString('base64url');

    const signInput = `${header}.${payload}`;
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(signInput);
    const signature = sign.sign(keyData.private_key, 'base64url');
    const jwt = `${signInput}.${signature}`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });

    const tokenData = await tokenRes.json() as any;
    return tokenData.access_token || null;
  } catch (err) {
    logger.error(`GCP token error: ${(err as any).message}`);
    return null;
  }
}

// ─── Content-type helper for S3/GCS ─────────────────────────
function getS3ContentType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const mimeMap: Record<string, string> = {
    html: 'text/html', htm: 'text/html',
    css: 'text/css', js: 'application/javascript',
    json: 'application/json', xml: 'application/xml',
    svg: 'image/svg+xml', png: 'image/png',
    jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp',
    ico: 'image/x-icon', woff: 'font/woff',
    woff2: 'font/woff2', ttf: 'font/ttf',
    txt: 'text/plain', md: 'text/markdown',
    pdf: 'application/pdf', zip: 'application/zip',
    ts: 'text/typescript', tsx: 'text/typescript',
    jsx: 'text/javascript', mjs: 'application/javascript',
    map: 'application/json', webmanifest: 'application/manifest+json',
  };
  return mimeMap[ext || ''] || 'application/octet-stream';
}

// ═══════════════════════════════════════════════════════════════
// EXPORT — Download project as zip
// ═══════════════════════════════════════════════════════════════

integrationsRoutes.post('/:id/export', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('id');
  await getOwnedProject(session.userId, projectId);

  const db = getDb();
  const files = await db.query.projectFiles.findMany({
    where: eq(projectFiles.projectId, projectId),
  });

  if (files.length === 0) {
    throw new AppError(400, 'NO_FILES', 'Project has no files to export.');
  }

  const totalSize = files.reduce((sum, f) => sum + (f.content?.length || 0), 0);
  if (totalSize > 10_000_000) {
    throw new AppError(413, 'PROJECT_TOO_LARGE', 'Project too large for direct download (>10MB). Use GitHub push instead.');
  }

  return c.json({
    success: true,
    data: {
      format: 'json-files',
      filesCount: files.length,
      sizeBytes: totalSize,
      files: files.map(f => ({ path: f.path, content: f.content || '', mimeType: f.mimeType || 'text/plain' })),
    },
  });
});

// ═══════════════════════════════════════════════════════════════
// ENVIRONMENT VARIABLES — Project secrets manager
// ═══════════════════════════════════════════════════════════════

integrationsRoutes.get('/:id/env', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('id');
  await getOwnedProject(session.userId, projectId);

  const db = getDb();
  const vars = await db.query.projectEnvVars.findMany({
    where: eq(projectEnvVars.projectId, projectId),
  });

  return c.json({
    success: true,
    data: vars.map(v => ({
      id: v.id,
      key: v.key,
      value: v.isSecret ? '••••••••' : v.value,
      isSecret: v.isSecret,
      description: v.description,
      updatedAt: v.updatedAt.toISOString(),
    })),
  });
});

const envVarSchema = z.object({
  key: z.string().min(1).max(128).regex(/^[A-Z_][A-Z0-9_]*$/, 'Key must be UPPER_SNAKE_CASE'),
  value: z.string().min(1),
  isSecret: z.boolean().default(true),
  description: z.string().max(255).optional(),
});

integrationsRoutes.post('/:id/env', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('id');
  await getOwnedProject(session.userId, projectId);

  const body = await c.req.json();
  const { key, value, isSecret, description } = envVarSchema.parse(body);

  const db = getDb();

  const existing = await db.query.projectEnvVars.findFirst({
    where: and(eq(projectEnvVars.projectId, projectId), eq(projectEnvVars.key, key)),
  });

  const storedValue = isSecret ? encrypt(value) : value;

  if (existing) {
    await db.update(projectEnvVars).set({
      value: storedValue,
      isSecret,
      description,
      updatedAt: new Date(),
    }).where(eq(projectEnvVars.id, existing.id));
  } else {
    await db.insert(projectEnvVars).values({
      projectId,
      key,
      value: storedValue,
      isSecret,
      description,
    });
  }

  return c.json({ success: true, data: { message: `Variable ${key} saved.` } });
});

integrationsRoutes.delete('/:id/env/:key', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('id');
  const key = c.req.param('key');
  await getOwnedProject(session.userId, projectId);

  const db = getDb();
  await db.delete(projectEnvVars)
    .where(and(eq(projectEnvVars.projectId, projectId), eq(projectEnvVars.key, key)));

  return c.json({ success: true, data: { message: `Variable ${key} deleted.` } });
});

// ═══════════════════════════════════════════════════════════════
// PUBLIC OAUTH CONNECT ROUTES (popup-based, no requireAuth)
// These run in a popup window opened by the Ship panel.
// Token is passed as ?token= query param, verified inline.
// Callbacks render a tiny HTML page that postMessages the result
// back to the opener (editor) window and closes itself.
// ═══════════════════════════════════════════════════════════════

// ─── GitHub OAuth (popup) ────────────────────────────────────
oauthConnectRoutes.get('/github', async (c) => {
  const token = c.req.query('token');
  const projectId = c.req.query('projectId');
  const userId = verifyTokenFromQuery(token);

  if (!GITHUB_CLIENT_ID) {
    return oauthPopupResult('github', false, 'GitHub OAuth not configured.');
  }

  const state = buildOAuthState(userId, projectId);
  const redirectUri = `${API_URL}/api/v1/connect/github/callback`;

  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'repo read:user user:email',
    state,
  });

  return c.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

oauthConnectRoutes.get('/github/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');

  if (error || !code || !state) {
    return oauthPopupResult('github', false, 'GitHub authorization was denied.');
  }

  const { userId } = parseOAuthState(state);
  if (!userId) {
    return oauthPopupResult('github', false, 'Invalid OAuth state.');
  }

  try {
    // Exchange code for access token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
      }),
    });
    const tokenData = await tokenRes.json() as any;

    if (!tokenData.access_token) {
      return oauthPopupResult('github', false, 'Failed to get GitHub access token.');
    }

    // Get user info from GitHub
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'SimpleBuildPro',
      },
    });
    const ghUser = await userRes.json() as any;

    const db = getDb();

    // Upsert the connection
    const existing = await db.query.userConnections.findFirst({
      where: and(eq(userConnections.userId, userId), eq(userConnections.provider, 'github_repo')),
    });

    const connectionData = {
      userId,
      provider: 'github_repo',
      displayName: ghUser.login,
      accessToken: encrypt(tokenData.access_token),
      refreshToken: tokenData.refresh_token ? encrypt(tokenData.refresh_token) : null,
      tokenExpiresAt: tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000) : null,
      accountId: String(ghUser.id),
      metadata: {
        login: ghUser.login,
        name: ghUser.name,
        avatarUrl: ghUser.avatar_url,
        scopes: tokenData.scope || 'repo',
      },
      updatedAt: new Date(),
    };

    if (existing) {
      await db.update(userConnections).set(connectionData).where(eq(userConnections.id, existing.id));
    } else {
      await db.insert(userConnections).values({ ...connectionData, connectedAt: new Date() });
    }

    logger.info(`GitHub connected via popup: ${ghUser.login} (user ${userId})`);
    return oauthPopupResult('github', true);
  } catch (err: any) {
    logger.error(`GitHub OAuth popup callback error: ${err.message}`);
    return oauthPopupResult('github', false, 'GitHub connection failed. Please try again.');
  }
});

// ─── Vercel OAuth (popup) ────────────────────────────────────
oauthConnectRoutes.get('/vercel', async (c) => {
  const token = c.req.query('token');
  const projectId = c.req.query('projectId');
  const userId = verifyTokenFromQuery(token);

  if (!VERCEL_CLIENT_ID) {
    return oauthPopupResult('vercel', false, 'Vercel integration not configured.');
  }

  const state = buildOAuthState(userId, projectId);
  const redirectUri = `${API_URL}/api/v1/connect/vercel/callback`;

  const params = new URLSearchParams({
    client_id: VERCEL_CLIENT_ID,
    redirect_uri: redirectUri,
    state,
  });

  return c.redirect(`https://vercel.com/integrations/new?${params}`);
});

oauthConnectRoutes.get('/vercel/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');

  if (!code || !state) {
    return oauthPopupResult('vercel', false, 'Vercel authorization was denied.');
  }

  const { userId } = parseOAuthState(state);
  if (!userId) return oauthPopupResult('vercel', false, 'Invalid OAuth state.');

  try {
    const redirectUri = `${API_URL}/api/v1/connect/vercel/callback`;
    const tokenRes = await fetch('https://api.vercel.com/v2/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: VERCEL_CLIENT_ID,
        client_secret: VERCEL_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
      }),
    });
    const tokenData = await tokenRes.json() as any;

    if (!tokenData.access_token) {
      return oauthPopupResult('vercel', false, 'Failed to get Vercel access token.');
    }

    const userRes = await fetch('https://api.vercel.com/v2/user', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const vercelUser = await userRes.json() as any;

    const db = getDb();
    const existing = await db.query.userConnections.findFirst({
      where: and(eq(userConnections.userId, userId), eq(userConnections.provider, 'vercel')),
    });

    const connectionData = {
      userId,
      provider: 'vercel',
      displayName: vercelUser.user?.username || vercelUser.user?.name || 'Vercel',
      accessToken: encrypt(tokenData.access_token),
      refreshToken: null,
      tokenExpiresAt: tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000) : null,
      accountId: tokenData.team_id || vercelUser.user?.id || null,
      metadata: {
        username: vercelUser.user?.username,
        teamId: tokenData.team_id,
      },
      updatedAt: new Date(),
    };

    if (existing) {
      await db.update(userConnections).set(connectionData).where(eq(userConnections.id, existing.id));
    } else {
      await db.insert(userConnections).values({ ...connectionData, connectedAt: new Date() });
    }

    logger.info(`Vercel connected via popup: ${connectionData.displayName} (user ${userId})`);
    return oauthPopupResult('vercel', true);
  } catch (err: any) {
    logger.error(`Vercel OAuth popup error: ${err.message}`);
    return oauthPopupResult('vercel', false, 'Vercel connection failed. Please try again.');
  }
});

// ─── Netlify OAuth (popup) ───────────────────────────────────
oauthConnectRoutes.get('/netlify', async (c) => {
  const token = c.req.query('token');
  const projectId = c.req.query('projectId');
  const userId = verifyTokenFromQuery(token);

  if (!NETLIFY_CLIENT_ID) {
    return oauthPopupResult('netlify', false, 'Netlify integration not configured.');
  }

  const state = buildOAuthState(userId, projectId);
  const redirectUri = `${API_URL}/api/v1/connect/netlify/callback`;

  const params = new URLSearchParams({
    client_id: NETLIFY_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
  });

  return c.redirect(`https://app.netlify.com/authorize?${params}`);
});

oauthConnectRoutes.get('/netlify/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');

  if (!code || !state) {
    return oauthPopupResult('netlify', false, 'Netlify authorization was denied.');
  }

  const { userId } = parseOAuthState(state);
  if (!userId) return oauthPopupResult('netlify', false, 'Invalid OAuth state.');

  try {
    const redirectUri = `${API_URL}/api/v1/connect/netlify/callback`;
    const tokenRes = await fetch('https://api.netlify.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: NETLIFY_CLIENT_ID,
        client_secret: NETLIFY_CLIENT_SECRET,
        redirect_uri: redirectUri,
      }),
    });
    const tokenData = await tokenRes.json() as any;

    if (!tokenData.access_token) {
      return oauthPopupResult('netlify', false, 'Failed to get Netlify access token.');
    }

    const userRes = await fetch('https://api.netlify.com/api/v1/user', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const netlifyUser = await userRes.json() as any;

    const db = getDb();
    const existing = await db.query.userConnections.findFirst({
      where: and(eq(userConnections.userId, userId), eq(userConnections.provider, 'netlify')),
    });

    const connectionData = {
      userId,
      provider: 'netlify',
      displayName: netlifyUser.full_name || netlifyUser.email || 'Netlify',
      accessToken: encrypt(tokenData.access_token),
      refreshToken: tokenData.refresh_token ? encrypt(tokenData.refresh_token) : null,
      tokenExpiresAt: null,
      accountId: netlifyUser.id || null,
      metadata: {
        email: netlifyUser.email,
        slug: netlifyUser.slug,
      },
      updatedAt: new Date(),
    };

    if (existing) {
      await db.update(userConnections).set(connectionData).where(eq(userConnections.id, existing.id));
    } else {
      await db.insert(userConnections).values({ ...connectionData, connectedAt: new Date() });
    }

    logger.info(`Netlify connected via popup: ${connectionData.displayName} (user ${userId})`);
    return oauthPopupResult('netlify', true);
  } catch (err: any) {
    logger.error(`Netlify OAuth popup error: ${err.message}`);
    return oauthPopupResult('netlify', false, 'Netlify connection failed. Please try again.');
  }
});
