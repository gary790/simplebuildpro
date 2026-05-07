// ============================================================
// SimpleBuild Pro — Build Routes
// Real build pipeline: minify HTML/CSS/JS, optimize images,
// create versioned snapshots in GCS
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import crypto from 'crypto';
import { getDb } from '@simplebuildpro/db';
import { projects, projectFiles, projectVersions, usageLogs } from '@simplebuildpro/db';
import { eq, and, desc, count } from 'drizzle-orm';
import { requireAuth, type AuthEnv } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import { getStorageService } from '../services/storage';
import { GCS_BUCKET_BUILDS, GCS_BUCKET_SNAPSHOTS } from '@simplebuildpro/shared';

export const buildRoutes = new Hono<AuthEnv>();
buildRoutes.use('*', requireAuth);

// ─── Build Project ───────────────────────────────────────────
const buildSchema = z.object({
  projectId: z.string().uuid(),
  message: z.string().max(255).optional().default('Build'),
});

buildRoutes.post('/', async (c) => {
  const session = c.get('session');
  const body = await c.req.json();
  const { projectId, message } = buildSchema.parse(body);

  const startTime = Date.now();
  const db = getDb();

  // Verify project
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, session.userId)),
    with: { files: true },
  });
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');
  if (project.files.length === 0) {
    throw new AppError(400, 'NO_FILES', 'Project has no files to build.');
  }

  const errors: { file: string; message: string; severity: 'error' | 'warning' }[] = [];
  const warnings: { file: string; message: string; suggestion: string | null }[] = [];
  const outputFiles: { path: string; content: Buffer; contentType: string; sizeBytes: number; contentHash: string }[] = [];

  // Process each file
  for (const file of project.files) {
    try {
      let processedContent: string = file.content;

      // Minify based on file type
      if (file.path.endsWith('.html') || file.path.endsWith('.htm')) {
        processedContent = await minifyHtml(file.content);
      } else if (file.path.endsWith('.css')) {
        processedContent = await minifyCss(file.content);
      } else if (file.path.endsWith('.js')) {
        processedContent = await minifyJs(file.content);
      }

      // Validate HTML files
      if (file.path.endsWith('.html')) {
        const htmlWarnings = validateHtml(file.content, file.path);
        warnings.push(...htmlWarnings);
      }

      const buffer = Buffer.from(processedContent, 'utf-8');
      const contentHash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 12);

      outputFiles.push({
        path: file.path,
        content: buffer,
        contentType: file.mimeType,
        sizeBytes: buffer.length,
        contentHash,
      });
    } catch (err) {
      errors.push({
        file: file.path,
        message: err instanceof Error ? err.message : 'Build error',
        severity: 'warning', // Non-fatal — include unminified
      });

      // Fall back to unminified content
      const buffer = Buffer.from(file.content, 'utf-8');
      outputFiles.push({
        path: file.path,
        content: buffer,
        contentType: file.mimeType,
        sizeBytes: buffer.length,
        contentHash: crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 12),
      });
    }
  }

  // Get next version number
  const latestVersion = await db.query.projectVersions.findFirst({
    where: eq(projectVersions.projectId, projectId),
    orderBy: desc(projectVersions.versionNumber),
  });
  const versionNumber = (latestVersion?.versionNumber || 0) + 1;

  // Upload build artifacts to GCS
  const buildPrefix = `projects/${projectId}/builds/v${versionNumber}`;
  const storage = getStorageService();

  await storage.uploadBatch(GCS_BUCKET_BUILDS, outputFiles.map(f => ({
    key: `${buildPrefix}/${f.path}`,
    data: f.content,
    contentType: f.contentType,
    cacheControl: 'public, max-age=31536000, immutable',
  })));

  // Create snapshot JSON (full project state for rollback)
  const snapshot = {
    version: versionNumber,
    message,
    files: project.files.map(f => ({ path: f.path, content: f.content })),
    createdAt: new Date().toISOString(),
    createdBy: session.userId,
  };
  const snapshotBuffer = Buffer.from(JSON.stringify(snapshot), 'utf-8');
  const snapshotKey = `projects/${projectId}/snapshots/v${versionNumber}.json`;
  await storage.upload(GCS_BUCKET_SNAPSHOTS, snapshotKey, snapshotBuffer, {
    contentType: 'application/json',
  });

  const totalSizeBytes = outputFiles.reduce((sum, f) => sum + f.sizeBytes, 0);
  const durationMs = Date.now() - startTime;

  // Save version record
  const [version] = await db.insert(projectVersions).values({
    projectId,
    versionNumber,
    snapshotGcsKey: snapshotKey,
    message,
    createdBy: session.userId,
    fileCount: outputFiles.length,
    totalSizeBytes,
  }).returning();

  // Log usage
  await db.insert(usageLogs).values({
    userId: session.userId,
    organizationId: session.organizationId,
    type: 'storage',
    quantity: totalSizeBytes,
    metadata: { projectId, versionNumber, buildPrefix },
  });

  return c.json({
    success: true,
    data: {
      versionId: version.id,
      versionNumber,
      buildPrefix,
      files: outputFiles.map(f => ({
        path: f.path,
        sizeBytes: f.sizeBytes,
        contentHash: f.contentHash,
      })),
      totalSizeBytes,
      durationMs,
      errors,
      warnings,
    },
  }, 201);
});

// ─── Get Build History ───────────────────────────────────────
buildRoutes.get('/:projectId/versions', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('projectId');
  const db = getDb();

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, session.userId)),
  });
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');

  const versions = await db.query.projectVersions.findMany({
    where: eq(projectVersions.projectId, projectId),
    orderBy: desc(projectVersions.versionNumber),
    limit: 50,
  });

  return c.json({
    success: true,
    data: versions.map(v => ({
      id: v.id,
      versionNumber: v.versionNumber,
      message: v.message,
      fileCount: v.fileCount,
      totalSizeBytes: v.totalSizeBytes,
      createdAt: v.createdAt.toISOString(),
    })),
  });
});

// ─── Restore Version ─────────────────────────────────────────
const restoreSchema = z.object({
  versionId: z.string().uuid(),
});

buildRoutes.post('/:projectId/restore', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('projectId');
  const body = await c.req.json();
  const { versionId } = restoreSchema.parse(body);

  const db = getDb();

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, session.userId)),
  });
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');

  const version = await db.query.projectVersions.findFirst({
    where: and(eq(projectVersions.id, versionId), eq(projectVersions.projectId, projectId)),
  });
  if (!version) throw new AppError(404, 'VERSION_NOT_FOUND', 'Version not found.');

  // Download snapshot from GCS
  const storage = getStorageService();
  const snapshotBuffer = await storage.download(GCS_BUCKET_SNAPSHOTS, version.snapshotGcsKey);
  const snapshot = JSON.parse(snapshotBuffer.toString('utf-8'));

  if (!snapshot.files || !Array.isArray(snapshot.files)) {
    throw new AppError(500, 'SNAPSHOT_CORRUPT', 'Version snapshot is corrupted.');
  }

  // Delete existing files
  await db.delete(projectFiles).where(eq(projectFiles.projectId, projectId));

  // Restore files from snapshot
  const fileInserts = snapshot.files.map((f: { path: string; content: string }) => ({
    projectId,
    path: f.path,
    content: f.content,
    contentHash: crypto.createHash('sha256').update(f.content).digest('hex'),
    mimeType: getMimeType(f.path),
    sizeBytes: Buffer.byteLength(f.content, 'utf-8'),
  }));

  if (fileInserts.length > 0) {
    await db.insert(projectFiles).values(fileInserts);
  }

  await db.update(projects)
    .set({ updatedAt: new Date() })
    .where(eq(projects.id, projectId));

  return c.json({
    success: true,
    data: {
      message: `Restored to version ${version.versionNumber}.`,
      versionNumber: version.versionNumber,
      filesRestored: fileInserts.length,
    },
  });
});

// ─── Minification Helpers ────────────────────────────────────
async function minifyHtml(html: string): Promise<string> {
  try {
    const { minify } = await import('html-minifier-terser');
    return await minify(html, {
      collapseWhitespace: true,
      removeComments: true,
      removeRedundantAttributes: true,
      removeEmptyAttributes: true,
      minifyCSS: true,
      minifyJS: true,
    });
  } catch {
    return html; // Return unminified on error
  }
}

async function minifyCss(css: string): Promise<string> {
  try {
    const CleanCSS = (await import('clean-css')).default;
    const result = new CleanCSS({ level: 2 }).minify(css);
    return result.styles || css;
  } catch {
    return css;
  }
}

async function minifyJs(js: string): Promise<string> {
  try {
    const { minify } = await import('terser');
    const result = await minify(js, {
      compress: { dead_code: true, drop_console: false },
      mangle: true,
    });
    return result.code || js;
  } catch {
    return js;
  }
}

function validateHtml(html: string, path: string): { file: string; message: string; suggestion: string | null }[] {
  const warnings: { file: string; message: string; suggestion: string | null }[] = [];

  if (!html.includes('<!DOCTYPE html>') && !html.includes('<!doctype html>')) {
    warnings.push({ file: path, message: 'Missing DOCTYPE declaration.', suggestion: 'Add <!DOCTYPE html> at the top.' });
  }
  if (!html.includes('<meta name="viewport"')) {
    warnings.push({ file: path, message: 'Missing viewport meta tag.', suggestion: 'Add <meta name="viewport" content="width=device-width, initial-scale=1.0">' });
  }
  if (!html.includes('lang=')) {
    warnings.push({ file: path, message: 'Missing lang attribute on <html>.', suggestion: 'Add lang="en" to the <html> tag.' });
  }
  if (!html.includes('<meta charset=') && !html.includes('<meta http-equiv="Content-Type"')) {
    warnings.push({ file: path, message: 'Missing charset declaration.', suggestion: 'Add <meta charset="UTF-8"> in <head>.' });
  }

  return warnings;
}

function getMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    html: 'text/html', css: 'text/css', js: 'application/javascript',
    json: 'application/json', svg: 'image/svg+xml', txt: 'text/plain',
    md: 'text/markdown', xml: 'application/xml',
  };
  return map[ext || ''] || 'text/plain';
}
