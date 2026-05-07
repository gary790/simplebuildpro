// ============================================================
// SimpleBuild Pro — Asset Routes
// Real asset upload/management via Google Cloud Storage
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '@simplebuildpro/db';
import { projects, projectAssets } from '@simplebuildpro/db';
import { eq, and, desc } from 'drizzle-orm';
import { requireAuth, type AuthEnv } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import { PLAN_LIMITS, GCS_BUCKET_ASSETS, CDN_URL } from '@simplebuildpro/shared';
import { rateLimiter } from '../middleware/rate-limiter';
import { getStorageService } from '../services/storage';
import { v4 as uuidv4 } from 'uuid';

export const assetRoutes = new Hono<AuthEnv>();
assetRoutes.use('*', requireAuth);
assetRoutes.use('*', rateLimiter('upload'));

// ─── List Assets ─────────────────────────────────────────────
assetRoutes.get('/:projectId', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('projectId');
  const db = getDb();

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, session.userId)),
  });
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');

  const assets = await db.query.projectAssets.findMany({
    where: eq(projectAssets.projectId, projectId),
    orderBy: desc(projectAssets.createdAt),
  });

  return c.json({
    success: true,
    data: assets.map(a => ({
      id: a.id,
      filename: a.filename,
      originalFilename: a.originalFilename,
      cdnUrl: a.cdnUrl,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      width: a.width,
      height: a.height,
      createdAt: a.createdAt.toISOString(),
    })),
  });
});

// ─── Upload Asset ────────────────────────────────────────────
// Accepts multipart/form-data with a "file" field
assetRoutes.post('/:projectId/upload', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('projectId');
  const db = getDb();

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, session.userId)),
  });
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');

  // Parse multipart form
  const formData = await c.req.formData();
  const file = formData.get('file');

  if (!file || !(file instanceof File)) {
    throw new AppError(400, 'NO_FILE', 'No file provided. Include a "file" field in multipart form data.');
  }

  // Validate file size
  const limits = PLAN_LIMITS[session.plan];
  if (file.size > limits.maxAssetSize) {
    throw new AppError(413, 'FILE_TOO_LARGE',
      `File exceeds ${limits.maxAssetSize / 1024 / 1024}MB limit for your ${session.plan} plan.`);
  }

  // Generate unique filename
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const uniqueFilename = `${uuidv4()}.${ext}`;
  const gcsKey = `projects/${projectId}/assets/${uniqueFilename}`;

  // Upload to GCS
  const storage = getStorageService();
  const buffer = Buffer.from(await file.arrayBuffer());

  await storage.upload(GCS_BUCKET_ASSETS, gcsKey, buffer, {
    contentType: file.type,
    cacheControl: 'public, max-age=31536000, immutable',
    metadata: {
      originalFilename: file.name,
      projectId,
      uploadedBy: session.userId,
    },
  });

  const cdnUrl = `${CDN_URL}/${gcsKey}`;

  // Get image dimensions if applicable
  let width: number | null = null;
  let height: number | null = null;

  if (file.type.startsWith('image/') && file.type !== 'image/svg+xml') {
    try {
      const sharp = (await import('sharp')).default;
      const metadata = await sharp(buffer).metadata();
      width = metadata.width || null;
      height = metadata.height || null;
    } catch {
      // Non-fatal — skip dimension extraction
    }
  }

  // Save to database
  const [asset] = await db.insert(projectAssets).values({
    projectId,
    filename: uniqueFilename,
    originalFilename: file.name,
    gcsKey,
    cdnUrl,
    mimeType: file.type,
    sizeBytes: file.size,
    width,
    height,
  }).returning();

  return c.json({
    success: true,
    data: {
      id: asset.id,
      filename: asset.filename,
      originalFilename: asset.originalFilename,
      cdnUrl: asset.cdnUrl,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      width: asset.width,
      height: asset.height,
      createdAt: asset.createdAt.toISOString(),
    },
  }, 201);
});

// ─── Generate Signed Upload URL (for large files) ────────────
assetRoutes.post('/:projectId/upload-url', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('projectId');
  const body = await c.req.json();

  const schema = z.object({
    filename: z.string().min(1).max(255),
    contentType: z.string().min(1),
    sizeBytes: z.number().positive(),
  });
  const { filename, contentType, sizeBytes } = schema.parse(body);

  const db = getDb();

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, session.userId)),
  });
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');

  const limits = PLAN_LIMITS[session.plan];
  if (sizeBytes > limits.maxAssetSize) {
    throw new AppError(413, 'FILE_TOO_LARGE',
      `File exceeds ${limits.maxAssetSize / 1024 / 1024}MB limit.`);
  }

  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const uniqueFilename = `${uuidv4()}.${ext}`;
  const gcsKey = `projects/${projectId}/assets/${uniqueFilename}`;

  const storage = getStorageService();
  const signedUrl = await storage.getSignedUploadUrl(GCS_BUCKET_ASSETS, gcsKey, contentType);

  return c.json({
    success: true,
    data: {
      uploadUrl: signedUrl,
      gcsKey,
      cdnUrl: `${CDN_URL}/${gcsKey}`,
      expiresIn: 3600, // 1 hour
    },
  });
});

// ─── Confirm Upload (after direct GCS upload) ────────────────
assetRoutes.post('/:projectId/confirm-upload', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('projectId');
  const body = await c.req.json();

  const schema = z.object({
    gcsKey: z.string().min(1),
    originalFilename: z.string().min(1).max(255),
    mimeType: z.string().min(1),
    sizeBytes: z.number().positive(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
  });
  const data = schema.parse(body);

  const db = getDb();

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, session.userId)),
  });
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');

  const filename = data.gcsKey.split('/').pop() || data.originalFilename;
  const cdnUrl = `${CDN_URL}/${data.gcsKey}`;

  const [asset] = await db.insert(projectAssets).values({
    projectId,
    filename,
    originalFilename: data.originalFilename,
    gcsKey: data.gcsKey,
    cdnUrl,
    mimeType: data.mimeType,
    sizeBytes: data.sizeBytes,
    width: data.width || null,
    height: data.height || null,
  }).returning();

  return c.json({
    success: true,
    data: {
      id: asset.id,
      filename: asset.filename,
      cdnUrl: asset.cdnUrl,
      createdAt: asset.createdAt.toISOString(),
    },
  }, 201);
});

// ─── Delete Asset ────────────────────────────────────────────
assetRoutes.delete('/:projectId/:assetId', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('projectId');
  const assetId = c.req.param('assetId');
  const db = getDb();

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, session.userId)),
  });
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');

  const asset = await db.query.projectAssets.findFirst({
    where: and(eq(projectAssets.id, assetId), eq(projectAssets.projectId, projectId)),
  });
  if (!asset) throw new AppError(404, 'ASSET_NOT_FOUND', 'Asset not found.');

  // Delete from GCS
  const storage = getStorageService();
  await storage.delete(GCS_BUCKET_ASSETS, asset.gcsKey).catch(() => {
    // Non-fatal — GCS object may already be deleted
  });

  // Delete from database
  await db.delete(projectAssets).where(eq(projectAssets.id, assetId));

  return c.json({ success: true, data: { message: 'Asset deleted.' } });
});
