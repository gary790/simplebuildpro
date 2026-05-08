// ============================================================
// SimpleBuild Pro — Integrations Routes (Ship Panel)
// GitHub push, Cloudflare deploy, zip export, settings
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '@simplebuildpro/db';
import { projects, projectFiles } from '@simplebuildpro/db';
import { eq, and } from 'drizzle-orm';
import { requireAuth, type AuthEnv } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import { logger } from '../services/logger';

export const integrationsRoutes = new Hono<AuthEnv>();
integrationsRoutes.use('*', requireAuth);

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

// ─── GET /projects/:id/integrations ─────────────────────────
integrationsRoutes.get('/:id/integrations', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('id');
  const project = await getOwnedProject(session.userId, projectId);

  const settings = (project.settings as Record<string, any>) || {};
  const integrations = settings.integrations || {};

  return c.json({
    success: true,
    data: {
      github: integrations.github || null,
      cloudflare: integrations.cloudflare || null,
    },
  });
});

// ─── PUT /projects/:id/integrations ─────────────────────────
const saveIntegrationsSchema = z.object({
  github: z.object({
    connected: z.boolean().optional(),
    owner: z.string().optional(),
    repo: z.string().optional(),
    branch: z.string().optional(),
  }).optional(),
  cloudflare: z.object({
    connected: z.boolean().optional(),
    projectName: z.string().optional(),
    accountId: z.string().optional(),
  }).optional(),
});

integrationsRoutes.put('/:id/integrations', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('id');
  const project = await getOwnedProject(session.userId, projectId);
  const body = await c.req.json();
  const updates = saveIntegrationsSchema.parse(body);

  const db = getDb();
  const currentSettings = (project.settings as Record<string, any>) || {};
  const currentIntegrations = currentSettings.integrations || {};

  // Merge updates
  if (updates.github) {
    if (updates.github.connected === false) {
      currentIntegrations.github = { connected: false };
    } else {
      currentIntegrations.github = {
        ...currentIntegrations.github,
        ...updates.github,
        connected: true,
      };
    }
  }
  if (updates.cloudflare) {
    if (updates.cloudflare.connected === false) {
      currentIntegrations.cloudflare = { connected: false };
    } else {
      currentIntegrations.cloudflare = {
        ...currentIntegrations.cloudflare,
        ...updates.cloudflare,
        connected: true,
      };
    }
  }

  await db.update(projects)
    .set({
      settings: { ...currentSettings, integrations: currentIntegrations },
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId));

  return c.json({ success: true, data: { message: 'Integrations updated.' } });
});

// ─── POST /projects/:id/github/push ─────────────────────────
const githubPushSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  branch: z.string().default('main'),
  commitMessage: z.string().default('Update from SimpleBuild Pro Studio'),
});

integrationsRoutes.post('/:id/github/push', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('id');
  const project = await getOwnedProject(session.userId, projectId);
  const body = await c.req.json();
  const { owner, repo, branch, commitMessage } = githubPushSchema.parse(body);

  const db = getDb();

  // Get all project files
  const files = await db.query.projectFiles.findMany({
    where: eq(projectFiles.projectId, projectId),
  });

  if (files.length === 0) {
    throw new AppError(400, 'NO_FILES', 'Project has no files to push.');
  }

  // Use GitHub API to push files via the Trees/Commits API
  const GITHUB_TOKEN = process.env.GITHUB_APP_TOKEN || process.env.GITHUB_TOKEN;
  if (!GITHUB_TOKEN) {
    throw new AppError(503, 'GITHUB_NOT_CONFIGURED', 'GitHub integration not configured on server. Contact support.');
  }

  const apiBase = `https://api.github.com/repos/${owner}/${repo}`;
  const headers = {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };

  try {
    // 1. Get the latest commit SHA for the branch (or create if doesn't exist)
    let baseSha: string | null = null;
    let baseTreeSha: string | null = null;

    try {
      const refRes = await fetch(`${apiBase}/git/ref/heads/${branch}`, { headers });
      if (refRes.ok) {
        const refData = await refRes.json() as any;
        baseSha = refData.object.sha;

        // Get the tree for this commit
        const commitRes = await fetch(`${apiBase}/git/commits/${baseSha}`, { headers });
        const commitData = await commitRes.json() as any;
        baseTreeSha = commitData.tree.sha;
      }
    } catch {
      // Branch doesn't exist yet — we'll create it
    }

    // 2. Create blobs for each file
    const treeItems: { path: string; mode: string; type: string; sha: string }[] = [];

    for (const file of files) {
      const blobRes = await fetch(`${apiBase}/git/blobs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          content: file.content || '',
          encoding: 'utf-8',
        }),
      });

      if (!blobRes.ok) {
        const err = await blobRes.json() as any;
        throw new Error(`Failed to create blob for ${file.path}: ${err.message}`);
      }

      const blobData = await blobRes.json() as any;
      treeItems.push({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: blobData.sha,
      });
    }

    // 3. Create a new tree
    const treePayload: Record<string, any> = { tree: treeItems };
    if (baseTreeSha) {
      treePayload.base_tree = baseTreeSha;
    }

    const treeRes = await fetch(`${apiBase}/git/trees`, {
      method: 'POST',
      headers,
      body: JSON.stringify(treePayload),
    });

    if (!treeRes.ok) {
      const err = await treeRes.json() as any;
      throw new Error(`Failed to create tree: ${err.message}`);
    }

    const treeData = await treeRes.json() as any;

    // 4. Create a commit
    const commitPayload: Record<string, any> = {
      message: commitMessage,
      tree: treeData.sha,
    };
    if (baseSha) {
      commitPayload.parents = [baseSha];
    }

    const commitRes = await fetch(`${apiBase}/git/commits`, {
      method: 'POST',
      headers,
      body: JSON.stringify(commitPayload),
    });

    if (!commitRes.ok) {
      const err = await commitRes.json() as any;
      throw new Error(`Failed to create commit: ${err.message}`);
    }

    const commitData = await commitRes.json() as any;

    // 5. Update or create the branch reference
    if (baseSha) {
      // Update existing ref
      await fetch(`${apiBase}/git/refs/heads/${branch}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ sha: commitData.sha, force: true }),
      });
    } else {
      // Create new ref
      await fetch(`${apiBase}/git/refs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commitData.sha }),
      });
    }

    // 6. Update project integrations with last push time
    const currentSettings = (project.settings as Record<string, any>) || {};
    const integrations = currentSettings.integrations || {};
    integrations.github = {
      ...(integrations.github || {}),
      connected: true,
      owner,
      repo,
      branch,
      lastPush: new Date().toISOString(),
    };

    await db.update(projects)
      .set({
        settings: { ...currentSettings, integrations },
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));

    logger.info(`GitHub push: ${owner}/${repo}#${branch} — ${files.length} files, commit ${commitData.sha.slice(0, 7)}`);

    return c.json({
      success: true,
      data: {
        filesCount: files.length,
        commitSha: commitData.sha,
        url: `https://github.com/${owner}/${repo}/tree/${branch}`,
      },
    });
  } catch (err: any) {
    logger.error(`GitHub push failed: ${err.message}`);
    throw new AppError(502, 'GITHUB_PUSH_FAILED', err.message);
  }
});

// ─── POST /projects/:id/cloudflare/deploy ───────────────────
integrationsRoutes.post('/:id/cloudflare/deploy', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('id');
  const project = await getOwnedProject(session.userId, projectId);

  const db = getDb();
  const currentSettings = (project.settings as Record<string, any>) || {};
  const integrations = currentSettings.integrations || {};
  const cfConfig = integrations.cloudflare;

  if (!cfConfig?.connected || !cfConfig?.projectName) {
    throw new AppError(400, 'CLOUDFLARE_NOT_CONFIGURED', 'Cloudflare is not connected. Set a project name first.');
  }

  const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
  if (!CF_API_TOKEN) {
    throw new AppError(503, 'CLOUDFLARE_NOT_CONFIGURED', 'Cloudflare API token not configured on server. Contact support.');
  }

  // Get project files
  const files = await db.query.projectFiles.findMany({
    where: eq(projectFiles.projectId, projectId),
  });

  if (files.length === 0) {
    throw new AppError(400, 'NO_FILES', 'Project has no files to deploy.');
  }

  try {
    // Use Cloudflare Pages Direct Upload API
    const accountId = cfConfig.accountId || process.env.CLOUDFLARE_ACCOUNT_ID;
    if (!accountId) {
      throw new AppError(503, 'CLOUDFLARE_ACCOUNT_MISSING', 'Cloudflare Account ID not configured.');
    }

    const cfHeaders = {
      'Authorization': `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    };

    // 1. Create a deployment (direct upload)
    // First, try to create the project if it doesn't exist
    const projectCheckRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${cfConfig.projectName}`,
      { headers: cfHeaders },
    );

    if (!projectCheckRes.ok) {
      // Try to create the project
      const createRes = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`,
        {
          method: 'POST',
          headers: cfHeaders,
          body: JSON.stringify({
            name: cfConfig.projectName,
            production_branch: 'main',
          }),
        },
      );
      if (!createRes.ok) {
        const err = await createRes.json() as any;
        throw new Error(`Failed to create Cloudflare project: ${JSON.stringify(err.errors)}`);
      }
    }

    // 2. Use the Direct Upload API to create a deployment with files
    // Build multipart form data with the files
    const formData = new FormData();

    for (const file of files) {
      const blob = new Blob([file.content || ''], { type: 'text/plain' });
      // Cloudflare expects files with their path as the key
      formData.append(file.path, blob, file.path);
    }

    const deployRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${cfConfig.projectName}/deployments`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CF_API_TOKEN}`,
        },
        body: formData,
      },
    );

    if (!deployRes.ok) {
      const err = await deployRes.json() as any;
      throw new Error(`Cloudflare deploy failed: ${JSON.stringify(err.errors)}`);
    }

    const deployData = await deployRes.json() as any;
    const deployUrl = deployData.result?.url || `https://${cfConfig.projectName}.pages.dev`;

    // 3. Update integrations with deploy info
    integrations.cloudflare = {
      ...cfConfig,
      lastDeploy: new Date().toISOString(),
      liveUrl: deployUrl,
    };

    await db.update(projects)
      .set({
        settings: { ...currentSettings, integrations },
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));

    logger.info(`Cloudflare deploy: ${cfConfig.projectName} — ${files.length} files → ${deployUrl}`);

    return c.json({
      success: true,
      data: {
        url: deployUrl,
        projectName: cfConfig.projectName,
        filesCount: files.length,
      },
    });
  } catch (err: any) {
    logger.error(`Cloudflare deploy failed: ${err.message}`);
    throw new AppError(502, 'CLOUDFLARE_DEPLOY_FAILED', err.message);
  }
});

// ─── POST /projects/:id/export ──────────────────────────────
integrationsRoutes.post('/:id/export', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('id');
  await getOwnedProject(session.userId, projectId);

  const db = getDb();

  // Get all project files
  const files = await db.query.projectFiles.findMany({
    where: eq(projectFiles.projectId, projectId),
  });

  if (files.length === 0) {
    throw new AppError(400, 'NO_FILES', 'Project has no files to export.');
  }

  // Generate a zip file in memory using a simple zip implementation
  // We'll use the built-in compression streams to create a downloadable archive
  // For simplicity, we'll create an in-memory zip and return it as base64,
  // or better yet, generate a temporary signed GCS URL

  // Simple approach: return files as a JSON payload that the client can zip
  // OR create a zip using GCS and return a signed URL

  // For now, use the simplest approach: create the zip inline and stream it back
  // We'll use a tar-like format that the client understands

  // Actually — let's use the approach of returning a data URL for small projects
  // and a GCS signed URL for larger ones

  const totalSize = files.reduce((sum, f) => sum + (f.content?.length || 0), 0);

  if (totalSize > 10_000_000) {
    // > 10MB — too large for inline response
    throw new AppError(413, 'PROJECT_TOO_LARGE', 'Project too large for direct download. Use GitHub push instead.');
  }

  // Return file contents as JSON — the client will use JSZip to create the actual zip
  return c.json({
    success: true,
    data: {
      format: 'json-files',
      filesCount: files.length,
      sizeBytes: totalSize,
      files: files.map(f => ({
        path: f.path,
        content: f.content || '',
        mimeType: f.mimeType || 'text/plain',
      })),
    },
  });
});
