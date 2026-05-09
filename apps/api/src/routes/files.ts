// ============================================================
// SimpleBuild Pro — File Routes
// Real CRUD for project files with content hashing
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import crypto from 'crypto';
import { getDb } from '@simplebuildpro/db';
import { projects, projectFiles } from '@simplebuildpro/db';
import { eq, and } from 'drizzle-orm';
import { requireAuth, type AuthEnv } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import { validateFilePath, PLAN_LIMITS } from '@simplebuildpro/shared';

export const fileRoutes = new Hono<AuthEnv>();
fileRoutes.use('*', requireAuth);

// ─── Get File Content ────────────────────────────────────────
fileRoutes.get('/:projectId/:path{.+}', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('projectId');
  const filePath = c.req.param('path');
  const db = getDb();

  // Verify project ownership
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, session.userId)),
  });
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');

  const file = await db.query.projectFiles.findFirst({
    where: and(eq(projectFiles.projectId, projectId), eq(projectFiles.path, filePath)),
  });

  if (!file) throw new AppError(404, 'FILE_NOT_FOUND', `File "${filePath}" not found.`);

  return c.json({
    success: true,
    data: {
      id: file.id,
      path: file.path,
      content: file.content,
      contentHash: file.contentHash,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      updatedAt: file.updatedAt.toISOString(),
    },
  });
});

// ─── List All Files for a Project ────────────────────────────
fileRoutes.get('/:projectId', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('projectId');
  const includeContent = c.req.query('content') === 'true';
  const db = getDb();

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, session.userId)),
  });
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');

  const files = await db.query.projectFiles.findMany({
    where: eq(projectFiles.projectId, projectId),
    orderBy: projectFiles.path,
  });

  return c.json({
    success: true,
    data: files.map((f) => ({
      id: f.id,
      path: f.path,
      ...(includeContent ? { content: f.content } : {}),
      contentHash: f.contentHash,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
      updatedAt: f.updatedAt.toISOString(),
    })),
  });
});

// ─── Create or Update File ───────────────────────────────────
const upsertFileSchema = z.object({
  path: z.string().min(1).max(512),
  content: z.string(),
});

fileRoutes.put('/:projectId', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('projectId');
  const body = await c.req.json();
  const { path: filePath, content } = upsertFileSchema.parse(body);

  // Validate path
  const pathValidation = validateFilePath(filePath);
  if (!pathValidation.valid) {
    throw new AppError(400, 'INVALID_PATH', pathValidation.error!);
  }

  const db = getDb();

  // Verify ownership
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, session.userId)),
  });
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');

  // Check file size limit
  const sizeBytes = Buffer.byteLength(content, 'utf-8');
  const limits = PLAN_LIMITS[session.plan];
  if (sizeBytes > limits.maxFileSize) {
    throw new AppError(
      413,
      'FILE_TOO_LARGE',
      `File exceeds ${limits.maxFileSize / 1024 / 1024}MB limit for your plan.`,
    );
  }

  const contentHash = crypto.createHash('sha256').update(content).digest('hex');
  const mimeType = getMimeType(filePath);

  // Check if file exists
  const existing = await db.query.projectFiles.findFirst({
    where: and(eq(projectFiles.projectId, projectId), eq(projectFiles.path, filePath)),
  });

  let file;
  if (existing) {
    // Update existing file
    [file] = await db
      .update(projectFiles)
      .set({ content, contentHash, mimeType, sizeBytes, updatedAt: new Date() })
      .where(eq(projectFiles.id, existing.id))
      .returning();
  } else {
    // Create new file
    [file] = await db
      .insert(projectFiles)
      .values({
        projectId,
        path: filePath,
        content,
        contentHash,
        mimeType,
        sizeBytes,
      })
      .returning();
  }

  // Update project timestamp
  await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));

  return c.json(
    {
      success: true,
      data: {
        id: file.id,
        path: file.path,
        contentHash: file.contentHash,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        created: !existing,
        updatedAt: file.updatedAt.toISOString(),
      },
    },
    existing ? 200 : 201,
  );
});

// ─── Bulk Update Files (from AI chat) ────────────────────────
const bulkUpsertSchema = z.object({
  files: z.record(z.string()), // { "index.html": "<content>", ... }
});

fileRoutes.put('/:projectId/bulk', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('projectId');
  const body = await c.req.json();
  const { files } = bulkUpsertSchema.parse(body);

  const db = getDb();

  // Verify ownership
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, session.userId)),
  });
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');

  const results: { path: string; created: boolean }[] = [];

  for (const [filePath, content] of Object.entries(files)) {
    const pathValidation = validateFilePath(filePath);
    if (!pathValidation.valid) continue; // Skip invalid paths

    const sizeBytes = Buffer.byteLength(content, 'utf-8');
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');
    const mimeType = getMimeType(filePath);

    const existing = await db.query.projectFiles.findFirst({
      where: and(eq(projectFiles.projectId, projectId), eq(projectFiles.path, filePath)),
    });

    if (existing) {
      await db
        .update(projectFiles)
        .set({ content, contentHash, mimeType, sizeBytes, updatedAt: new Date() })
        .where(eq(projectFiles.id, existing.id));
      results.push({ path: filePath, created: false });
    } else {
      await db.insert(projectFiles).values({
        projectId,
        path: filePath,
        content,
        contentHash,
        mimeType,
        sizeBytes,
      });
      results.push({ path: filePath, created: true });
    }
  }

  await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));

  return c.json({
    success: true,
    data: { updated: results.length, files: results },
  });
});

// ─── Delete File ─────────────────────────────────────────────
fileRoutes.delete('/:projectId/:path{.+}', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('projectId');
  const filePath = c.req.param('path');
  const db = getDb();

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, session.userId)),
  });
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');

  const file = await db.query.projectFiles.findFirst({
    where: and(eq(projectFiles.projectId, projectId), eq(projectFiles.path, filePath)),
  });
  if (!file) throw new AppError(404, 'FILE_NOT_FOUND', `File "${filePath}" not found.`);

  await db.delete(projectFiles).where(eq(projectFiles.id, file.id));

  return c.json({ success: true, data: { message: `File "${filePath}" deleted.` } });
});

// ─── Rename File ─────────────────────────────────────────────
const renameSchema = z.object({
  oldPath: z.string().min(1),
  newPath: z.string().min(1).max(512),
});

fileRoutes.post('/:projectId/rename', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('projectId');
  const body = await c.req.json();
  const { oldPath, newPath } = renameSchema.parse(body);

  const pathValidation = validateFilePath(newPath);
  if (!pathValidation.valid) throw new AppError(400, 'INVALID_PATH', pathValidation.error!);

  const db = getDb();

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, session.userId)),
  });
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');

  const file = await db.query.projectFiles.findFirst({
    where: and(eq(projectFiles.projectId, projectId), eq(projectFiles.path, oldPath)),
  });
  if (!file) throw new AppError(404, 'FILE_NOT_FOUND', `File "${oldPath}" not found.`);

  // Check target doesn't exist
  const target = await db.query.projectFiles.findFirst({
    where: and(eq(projectFiles.projectId, projectId), eq(projectFiles.path, newPath)),
  });
  if (target) throw new AppError(409, 'FILE_EXISTS', `File "${newPath}" already exists.`);

  await db
    .update(projectFiles)
    .set({ path: newPath, mimeType: getMimeType(newPath), updatedAt: new Date() })
    .where(eq(projectFiles.id, file.id));

  return c.json({ success: true, data: { oldPath, newPath } });
});

// ─── Helpers ─────────────────────────────────────────────────
function getMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    html: 'text/html',
    htm: 'text/html',
    css: 'text/css',
    scss: 'text/x-scss',
    less: 'text/x-less',
    js: 'application/javascript',
    jsx: 'application/javascript',
    ts: 'application/typescript',
    tsx: 'application/typescript',
    json: 'application/json',
    xml: 'application/xml',
    svg: 'image/svg+xml',
    md: 'text/markdown',
    txt: 'text/plain',
    yaml: 'text/yaml',
    yml: 'text/yaml',
  };
  return map[ext || ''] || 'text/plain';
}
