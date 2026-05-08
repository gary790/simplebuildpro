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
import { requireAuth, type AuthEnv } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import { logger } from '../services/logger';

export const integrationsRoutes = new Hono<AuthEnv>();
integrationsRoutes.use('*', requireAuth);

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
integrationsRoutes.get('/connect/github', async (c) => {
  const session = c.get('session');

  if (!GITHUB_CLIENT_ID) {
    throw new AppError(503, 'GITHUB_NOT_CONFIGURED', 'GitHub OAuth not configured.');
  }

  const state = crypto.randomBytes(16).toString('hex') + ':' + session.userId;
  const redirectUri = `${API_URL}/api/v1/projects/connect/github/callback`;

  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'repo read:user user:email',
    state,
  });

  return c.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

// Step 2: GitHub OAuth callback
integrationsRoutes.get('/connect/github/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');

  if (error || !code || !state) {
    return c.redirect(`${APP_URL}/dashboard?error=github_denied`);
  }

  const userId = state.split(':')[1];
  if (!userId) {
    return c.redirect(`${APP_URL}/dashboard?error=invalid_state`);
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
      return c.redirect(`${APP_URL}/dashboard?error=github_token_failed`);
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

    logger.info(`GitHub connected: ${ghUser.login} (user ${userId})`);
    return c.redirect(`${APP_URL}/dashboard?connected=github`);
  } catch (err: any) {
    logger.error(`GitHub OAuth callback error: ${err.message}`);
    return c.redirect(`${APP_URL}/dashboard?error=github_failed`);
  }
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

  if (!VERCEL_CLIENT_ID) {
    throw new AppError(503, 'VERCEL_NOT_CONFIGURED', 'Vercel integration not configured.');
  }

  const state = crypto.randomBytes(16).toString('hex') + ':' + session.userId;
  const redirectUri = `${API_URL}/api/v1/projects/connect/vercel/callback`;

  const params = new URLSearchParams({
    client_id: VERCEL_CLIENT_ID,
    redirect_uri: redirectUri,
    state,
  });

  return c.redirect(`https://vercel.com/integrations/new?${params}`);
});

integrationsRoutes.get('/connect/vercel/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');

  if (!code || !state) {
    return c.redirect(`${APP_URL}/dashboard?error=vercel_denied`);
  }

  const userId = state.split(':')[1];
  if (!userId) return c.redirect(`${APP_URL}/dashboard?error=invalid_state`);

  try {
    const redirectUri = `${API_URL}/api/v1/projects/connect/vercel/callback`;
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
      return c.redirect(`${APP_URL}/dashboard?error=vercel_token_failed`);
    }

    // Get Vercel user info
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

    logger.info(`Vercel connected: ${connectionData.displayName} (user ${userId})`);
    return c.redirect(`${APP_URL}/dashboard?connected=vercel`);
  } catch (err: any) {
    logger.error(`Vercel OAuth error: ${err.message}`);
    return c.redirect(`${APP_URL}/dashboard?error=vercel_failed`);
  }
});

// ═══════════════════════════════════════════════════════════════
// NETLIFY OAUTH — Connect
// ═══════════════════════════════════════════════════════════════

integrationsRoutes.get('/connect/netlify', async (c) => {
  const session = c.get('session');

  if (!NETLIFY_CLIENT_ID) {
    throw new AppError(503, 'NETLIFY_NOT_CONFIGURED', 'Netlify integration not configured.');
  }

  const state = crypto.randomBytes(16).toString('hex') + ':' + session.userId;
  const redirectUri = `${API_URL}/api/v1/projects/connect/netlify/callback`;

  const params = new URLSearchParams({
    client_id: NETLIFY_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
  });

  return c.redirect(`https://app.netlify.com/authorize?${params}`);
});

integrationsRoutes.get('/connect/netlify/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');

  if (!code || !state) {
    return c.redirect(`${APP_URL}/dashboard?error=netlify_denied`);
  }

  const userId = state.split(':')[1];
  if (!userId) return c.redirect(`${APP_URL}/dashboard?error=invalid_state`);

  try {
    const redirectUri = `${API_URL}/api/v1/projects/connect/netlify/callback`;
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
      return c.redirect(`${APP_URL}/dashboard?error=netlify_token_failed`);
    }

    // Get Netlify user info
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

    logger.info(`Netlify connected: ${connectionData.displayName} (user ${userId})`);
    return c.redirect(`${APP_URL}/dashboard?connected=netlify`);
  } catch (err: any) {
    logger.error(`Netlify OAuth error: ${err.message}`);
    return c.redirect(`${APP_URL}/dashboard?error=netlify_failed`);
  }
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
