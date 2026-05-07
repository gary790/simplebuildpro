// ============================================================
// SimpleBuild Pro — Project Routes
// Real CRUD for website projects with GCS storage
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '@simplebuildpro/db';
import { projects, projectFiles, projectAssets, projectVersions, deployments } from '@simplebuildpro/db';
import { eq, and, desc, sql, count } from 'drizzle-orm';
import { requireAuth, type AuthEnv } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import { PLAN_LIMITS, STARTER_TEMPLATES } from '@simplebuildpro/shared';
import { slugify } from '@simplebuildpro/shared';
import crypto from 'crypto';

export const projectRoutes = new Hono<AuthEnv>();
projectRoutes.use('*', requireAuth);

// ─── List Projects ───────────────────────────────────────────
projectRoutes.get('/', async (c) => {
  const session = c.get('session');
  const db = getDb();

  const page = parseInt(c.req.query('page') || '1');
  const pageSize = Math.min(parseInt(c.req.query('pageSize') || '20'), 50);
  const status = c.req.query('status');
  const offset = (page - 1) * pageSize;

  const conditions = [eq(projects.ownerId, session.userId)];
  if (status && ['draft', 'published', 'archived'].includes(status)) {
    conditions.push(eq(projects.status, status as any));
  }

  const [projectList, totalResult] = await Promise.all([
    db.query.projects.findMany({
      where: and(...conditions),
      orderBy: desc(projects.updatedAt),
      limit: pageSize,
      offset,
      with: {
        deployments: {
          limit: 1,
          orderBy: desc(deployments.createdAt),
        },
      },
    }),
    db.select({ count: count() }).from(projects).where(and(...conditions)),
  ]);

  const total = totalResult[0]?.count || 0;

  return c.json({
    success: true,
    data: {
      items: projectList.map(p => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        description: p.description,
        status: p.status,
        templateId: p.templateId,
        settings: p.settings,
        lastDeployedAt: p.lastDeployedAt?.toISOString() || null,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
        latestDeployment: p.deployments[0] ? {
          id: p.deployments[0].id,
          status: p.deployments[0].status,
          url: p.deployments[0].url,
        } : null,
      })),
      total,
      page,
      pageSize,
      hasMore: offset + pageSize < total,
    },
  });
});

// ─── Get Single Project ──────────────────────────────────────
projectRoutes.get('/:id', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('id');
  const db = getDb();

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, session.userId)),
    with: {
      files: true,
      assets: true,
      versions: {
        orderBy: desc(projectVersions.versionNumber),
        limit: 10,
      },
    },
  });

  if (!project) {
    throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');
  }

  return c.json({
    success: true,
    data: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      description: project.description,
      status: project.status,
      templateId: project.templateId,
      settings: project.settings,
      lastDeployedAt: project.lastDeployedAt?.toISOString() || null,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      files: project.files.map(f => ({
        id: f.id,
        path: f.path,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        updatedAt: f.updatedAt.toISOString(),
      })),
      assets: project.assets.map(a => ({
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
      versions: project.versions.map(v => ({
        id: v.id,
        versionNumber: v.versionNumber,
        message: v.message,
        fileCount: v.fileCount,
        totalSizeBytes: v.totalSizeBytes,
        createdAt: v.createdAt.toISOString(),
      })),
    },
  });
});

// ─── Create Project ──────────────────────────────────────────
const createProjectSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(500).optional(),
  templateId: z.string().optional(),
});

projectRoutes.post('/', async (c) => {
  const session = c.get('session');
  const body = await c.req.json();
  const { name, description, templateId } = createProjectSchema.parse(body);

  const db = getDb();

  // Check project limit
  const limits = PLAN_LIMITS[session.plan];
  if (limits.projects !== -1) {
    const [{ count: projectCount }] = await db.select({ count: count() })
      .from(projects)
      .where(eq(projects.ownerId, session.userId));

    if (projectCount >= limits.projects) {
      throw new AppError(403, 'PROJECT_LIMIT', `Your ${session.plan} plan allows ${limits.projects} projects. Upgrade to create more.`);
    }
  }

  const slug = slugify(name);

  // Create project
  const [project] = await db.insert(projects).values({
    ownerId: session.userId,
    organizationId: session.organizationId,
    name,
    slug,
    description: description || null,
    templateId: templateId || null,
    settings: {
      framework: 'static',
      cssFramework: 'none',
      customDomain: null,
      favicon: null,
      meta: { title: name, description: description || '', ogImage: null },
    },
    status: 'draft',
  }).returning();

  // If template specified, create initial files from template
  if (templateId) {
    const template = STARTER_TEMPLATES.find(t => t.id === templateId);
    if (template) {
      const fileInserts = Object.entries(template.files).map(([path, content]) => {
        const contentStr = content as string;
        return {
          projectId: project.id,
          path,
          content: contentStr,
          contentHash: crypto.createHash('sha256').update(contentStr).digest('hex'),
          mimeType: getMimeType(path),
          sizeBytes: Buffer.byteLength(contentStr, 'utf-8'),
        };
      });

      if (fileInserts.length > 0) {
        await db.insert(projectFiles).values(fileInserts);
      }
    }
  }

  return c.json({
    success: true,
    data: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      description: project.description,
      status: project.status,
      templateId: project.templateId,
      createdAt: project.createdAt.toISOString(),
    },
  }, 201);
});

// ─── Update Project ──────────────────────────────────────────
const updateProjectSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  description: z.string().max(500).optional().nullable(),
  settings: z.record(z.unknown()).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
});

projectRoutes.patch('/:id', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('id');
  const body = await c.req.json();
  const updates = updateProjectSchema.parse(body);

  const db = getDb();

  const existing = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, session.userId)),
  });

  if (!existing) {
    throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');
  }

  const updateData: Record<string, any> = { updatedAt: new Date() };
  if (updates.name !== undefined) {
    updateData.name = updates.name;
    updateData.slug = slugify(updates.name);
  }
  if (updates.description !== undefined) updateData.description = updates.description;
  if (updates.status !== undefined) updateData.status = updates.status;
  if (updates.settings !== undefined) {
    updateData.settings = { ...(existing.settings as Record<string, unknown>), ...updates.settings };
  }

  const [updated] = await db.update(projects)
    .set(updateData)
    .where(eq(projects.id, projectId))
    .returning();

  return c.json({
    success: true,
    data: {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      description: updated.description,
      status: updated.status,
      settings: updated.settings,
      updatedAt: updated.updatedAt.toISOString(),
    },
  });
});

// ─── Delete Project ──────────────────────────────────────────
projectRoutes.delete('/:id', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('id');
  const db = getDb();

  const existing = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, session.userId)),
  });

  if (!existing) {
    throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');
  }

  // Cascade delete handles files, assets, versions, deployments, conversations
  await db.delete(projects).where(eq(projects.id, projectId));

  // TODO: Queue GCS cleanup job to delete associated assets and builds from storage

  return c.json({ success: true, data: { message: 'Project deleted.' } });
});

// ─── Helpers ─────────────────────────────────────────────────
function getMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    html: 'text/html', htm: 'text/html',
    css: 'text/css', scss: 'text/x-scss', less: 'text/x-less',
    js: 'application/javascript', jsx: 'application/javascript',
    ts: 'application/typescript', tsx: 'application/typescript',
    json: 'application/json', xml: 'application/xml',
    svg: 'image/svg+xml', md: 'text/markdown',
    txt: 'text/plain', yaml: 'text/yaml', yml: 'text/yaml',
    toml: 'text/toml',
  };
  return map[ext || ''] || 'text/plain';
}
