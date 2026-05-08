// ============================================================
// SimpleBuild Pro — Sandbox Routes
// REST API for managing E2B sandboxes per project
// Start, stop, exec, file ops
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '@simplebuildpro/db';
import { projects, projectFiles } from '@simplebuildpro/db';
import { eq, and } from 'drizzle-orm';
import { requireAuth, type AuthEnv } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import * as sandboxService from '../services/sandbox';
import { logger } from '../services/logger';

export const sandboxRoutes = new Hono<AuthEnv>();
sandboxRoutes.use('*', requireAuth);

// ─── Start or resume sandbox for a project ──────────────────
sandboxRoutes.post('/:projectId/start', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('projectId');
  const db = getDb();

  // Verify project ownership
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, session.userId)),
    with: { files: true },
  });
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');

  try {
    // Create or get existing sandbox
    const info = await sandboxService.getOrCreateSandbox(projectId);

    // If this is a fresh sandbox, restore files from DB
    if (project.files && project.files.length > 0) {
      const fileList = await sandboxService.listFiles(projectId, '.').catch(() => []);
      // Only restore if sandbox is empty (no project files yet)
      const hasProjectFiles = fileList.some(f => !f.isDir && f.path !== 'package.json' && f.path !== 'package-lock.json');
      if (!hasProjectFiles) {
        const filesToRestore = project.files.map((f: any) => ({
          path: f.path,
          content: f.content || '',
        }));
        await sandboxService.restoreFilesFromDB(projectId, filesToRestore);
      }
    }

    // Start the dev server
    const previewUrl = await sandboxService.startDevServer(projectId);

    return c.json({
      success: true,
      data: {
        ...info,
        previewUrl: previewUrl || info.previewUrl,
      },
    });
  } catch (err: any) {
    logger.error(`[Sandbox Route] Start failed for project ${projectId}: ${err.message}`);
    throw new AppError(500, 'SANDBOX_START_FAILED', `Failed to start sandbox: ${err.message}`);
  }
});

// ─── Stop sandbox ───────────────────────────────────────────
sandboxRoutes.post('/:projectId/stop', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('projectId');
  const db = getDb();

  // Verify ownership
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, session.userId)),
  });
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');

  try {
    // Snapshot files back to DB before stopping
    const sandbox = sandboxService.getActiveSandbox(projectId);
    if (sandbox) {
      const snapshotFiles = await sandboxService.snapshotFiles(projectId);
      if (snapshotFiles.length > 0) {
        // Persist to DB as backup
        for (const file of snapshotFiles) {
          const existing = await db.query.projectFiles.findFirst({
            where: and(eq(projectFiles.projectId, projectId), eq(projectFiles.path, file.path)),
          });
          const contentHash = Buffer.from(file.content).toString('base64').slice(0, 64);
          const sizeBytes = Buffer.byteLength(file.content, 'utf-8');

          if (existing) {
            await db.update(projectFiles).set({
              content: file.content, contentHash, sizeBytes, updatedAt: new Date(),
            }).where(eq(projectFiles.id, existing.id));
          } else {
            await db.insert(projectFiles).values({
              projectId, path: file.path, content: file.content,
              contentHash, mimeType: 'text/plain', sizeBytes,
            });
          }
        }
        logger.info(`[Sandbox Route] Snapshotted ${snapshotFiles.length} files for project ${projectId}`);
      }
    }

    await sandboxService.stopSandbox(projectId);

    return c.json({ success: true, data: { message: 'Sandbox stopped and files snapshotted.' } });
  } catch (err: any) {
    logger.error(`[Sandbox Route] Stop failed: ${err.message}`);
    throw new AppError(500, 'SANDBOX_STOP_FAILED', `Failed to stop sandbox: ${err.message}`);
  }
});

// ─── Get sandbox status ─────────────────────────────────────
sandboxRoutes.get('/:projectId/status', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('projectId');
  const db = getDb();

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, session.userId)),
  });
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');

  const status = sandboxService.getSandboxStatus(projectId);

  return c.json({
    success: true,
    data: status || { projectId, status: 'stopped', previewUrl: null },
  });
});

// ─── Execute a command ──────────────────────────────────────
sandboxRoutes.post('/:projectId/exec', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('projectId');
  const body = await c.req.json();
  const { command } = z.object({ command: z.string().min(1).max(10000) }).parse(body);
  const db = getDb();

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, session.userId)),
  });
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');

  const sandbox = sandboxService.getActiveSandbox(projectId);
  if (!sandbox) throw new AppError(400, 'SANDBOX_NOT_RUNNING', 'No active sandbox. Start one first.');

  try {
    const result = await sandboxService.execCommand(projectId, command);
    return c.json({ success: true, data: result });
  } catch (err: any) {
    throw new AppError(500, 'EXEC_FAILED', `Command failed: ${err.message}`);
  }
});

// ─── List files ─────────────────────────────────────────────
sandboxRoutes.get('/:projectId/files', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('projectId');
  const db = getDb();

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, session.userId)),
  });
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');

  const sandbox = sandboxService.getActiveSandbox(projectId);
  if (!sandbox) throw new AppError(400, 'SANDBOX_NOT_RUNNING', 'No active sandbox.');

  try {
    const files = await sandboxService.listFiles(projectId, c.req.query('path') || '.');
    return c.json({ success: true, data: files });
  } catch (err: any) {
    throw new AppError(500, 'LIST_FILES_FAILED', `Failed to list files: ${err.message}`);
  }
});

// ─── Read a file ────────────────────────────────────────────
sandboxRoutes.get('/:projectId/files/*', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('projectId');
  const filePath = c.req.path.replace(`/api/v1/sandbox/${projectId}/files/`, '');
  const db = getDb();

  if (!filePath) throw new AppError(400, 'MISSING_PATH', 'File path required.');

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, session.userId)),
  });
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');

  const sandbox = sandboxService.getActiveSandbox(projectId);
  if (!sandbox) throw new AppError(400, 'SANDBOX_NOT_RUNNING', 'No active sandbox.');

  try {
    const content = await sandboxService.readFile(projectId, filePath);
    return c.json({ success: true, data: { path: filePath, content } });
  } catch (err: any) {
    throw new AppError(404, 'FILE_NOT_FOUND', `File not found: ${filePath}`);
  }
});

// ─── Write a file ───────────────────────────────────────────
sandboxRoutes.put('/:projectId/files/*', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('projectId');
  const filePath = c.req.path.replace(`/api/v1/sandbox/${projectId}/files/`, '');
  const body = await c.req.json();
  const { content } = z.object({ content: z.string() }).parse(body);
  const db = getDb();

  if (!filePath) throw new AppError(400, 'MISSING_PATH', 'File path required.');

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, session.userId)),
  });
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');

  const sandbox = sandboxService.getActiveSandbox(projectId);
  if (!sandbox) throw new AppError(400, 'SANDBOX_NOT_RUNNING', 'No active sandbox.');

  try {
    await sandboxService.writeFile(projectId, filePath, content);
    return c.json({ success: true, data: { path: filePath, size: content.length } });
  } catch (err: any) {
    throw new AppError(500, 'WRITE_FAILED', `Failed to write file: ${err.message}`);
  }
});

// ─── Delete a file ──────────────────────────────────────────
sandboxRoutes.delete('/:projectId/files/*', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('projectId');
  const filePath = c.req.path.replace(`/api/v1/sandbox/${projectId}/files/`, '');
  const db = getDb();

  if (!filePath) throw new AppError(400, 'MISSING_PATH', 'File path required.');

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, session.userId)),
  });
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');

  const sandbox = sandboxService.getActiveSandbox(projectId);
  if (!sandbox) throw new AppError(400, 'SANDBOX_NOT_RUNNING', 'No active sandbox.');

  try {
    await sandboxService.execCommand(projectId, `rm -rf "/home/user/project/${filePath}"`);
    return c.json({ success: true, data: { message: `Deleted ${filePath}` } });
  } catch (err: any) {
    throw new AppError(500, 'DELETE_FAILED', `Failed to delete: ${err.message}`);
  }
});
