// ============================================================
// SimpleBuild Pro — Preview Routes
// Real Novita Sandbox integration for isolated website preview
// Uses novita-sandbox SDK — real API, real sandboxes
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '@simplebuildpro/db';
import { projects, projectFiles, previewSessions } from '@simplebuildpro/db';
import { eq, and } from 'drizzle-orm';
import { requireAuth, type AuthEnv } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import { getNovitaService } from '../services/novita';
import { NOVITA_SANDBOX_TIMEOUT_MS } from '@simplebuildpro/shared';

export const previewRoutes = new Hono<AuthEnv>();
previewRoutes.use('*', requireAuth);

// ─── Create Preview Session ──────────────────────────────────
// Spins up a real Novita sandbox, writes project files, starts a local server
const createPreviewSchema = z.object({
  projectId: z.string().uuid(),
});

previewRoutes.post('/start', async (c) => {
  const session = c.get('session');
  const body = await c.req.json();
  const { projectId } = createPreviewSchema.parse(body);

  const db = getDb();

  // Verify project ownership
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, session.userId)),
    with: { files: true },
  });
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');

  if (project.files.length === 0) {
    throw new AppError(400, 'NO_FILES', 'Project has no files to preview.');
  }

  // Check for existing active session
  const existingSession = await db.query.previewSessions.findFirst({
    where: and(
      eq(previewSessions.projectId, projectId),
      eq(previewSessions.userId, session.userId),
      eq(previewSessions.status, 'running'),
    ),
  });

  if (existingSession) {
    // Extend existing sandbox timeout and update files
    const novita = getNovitaService();
    try {
      await novita.updateSandboxFiles(
        existingSession.novitaSandboxId,
        project.files.map(f => ({ path: f.path, content: f.content })),
      );
      await novita.extendTimeout(existingSession.novitaSandboxId, NOVITA_SANDBOX_TIMEOUT_MS);

      return c.json({
        success: true,
        data: {
          sessionId: existingSession.id,
          sandboxId: existingSession.novitaSandboxId,
          previewUrl: existingSession.previewUrl,
          status: 'running',
          reused: true,
        },
      });
    } catch {
      // Sandbox may have died — clean up and create new one
      await db.update(previewSessions)
        .set({ status: 'stopped' })
        .where(eq(previewSessions.id, existingSession.id));
    }
  }

  // Create new Novita sandbox
  const novita = getNovitaService();
  const sandbox = await novita.createPreviewSandbox(
    project.files.map(f => ({ path: f.path, content: f.content })),
  );

  // Save session to database
  const expiresAt = new Date(Date.now() + NOVITA_SANDBOX_TIMEOUT_MS);
  const [previewSession] = await db.insert(previewSessions).values({
    projectId,
    userId: session.userId,
    novitaSandboxId: sandbox.sandboxId,
    previewUrl: sandbox.previewUrl,
    status: 'running',
    expiresAt,
  }).returning();

  return c.json({
    success: true,
    data: {
      sessionId: previewSession.id,
      sandboxId: sandbox.sandboxId,
      previewUrl: sandbox.previewUrl,
      status: 'running',
      expiresAt: expiresAt.toISOString(),
      reused: false,
    },
  }, 201);
});

// ─── Update Preview Files (Hot Reload) ───────────────────────
const updatePreviewSchema = z.object({
  sessionId: z.string().uuid(),
  files: z.record(z.string()), // { "index.html": "<content>", ... }
});

previewRoutes.post('/update', async (c) => {
  const session = c.get('session');
  const body = await c.req.json();
  const { sessionId, files } = updatePreviewSchema.parse(body);

  const db = getDb();

  const previewSession = await db.query.previewSessions.findFirst({
    where: and(
      eq(previewSessions.id, sessionId),
      eq(previewSessions.userId, session.userId),
      eq(previewSessions.status, 'running'),
    ),
  });

  if (!previewSession) {
    throw new AppError(404, 'SESSION_NOT_FOUND', 'Preview session not found or has stopped.');
  }

  const novita = getNovitaService();
  await novita.updateSandboxFiles(
    previewSession.novitaSandboxId,
    Object.entries(files).map(([path, content]) => ({ path, content })),
  );

  return c.json({
    success: true,
    data: { message: 'Preview files updated.', filesUpdated: Object.keys(files).length },
  });
});

// ─── Get Preview Status ──────────────────────────────────────
previewRoutes.get('/status/:sessionId', async (c) => {
  const session = c.get('session');
  const sessionId = c.req.param('sessionId');
  const db = getDb();

  const previewSession = await db.query.previewSessions.findFirst({
    where: and(
      eq(previewSessions.id, sessionId),
      eq(previewSessions.userId, session.userId),
    ),
  });

  if (!previewSession) {
    throw new AppError(404, 'SESSION_NOT_FOUND', 'Preview session not found.');
  }

  // Check if sandbox is still alive
  if (previewSession.status === 'running') {
    const novita = getNovitaService();
    const isAlive = await novita.isSandboxAlive(previewSession.novitaSandboxId);

    if (!isAlive) {
      await db.update(previewSessions)
        .set({ status: 'stopped' })
        .where(eq(previewSessions.id, sessionId));
      previewSession.status = 'stopped' as any;
    }
  }

  return c.json({
    success: true,
    data: {
      sessionId: previewSession.id,
      sandboxId: previewSession.novitaSandboxId,
      previewUrl: previewSession.previewUrl,
      status: previewSession.status,
      expiresAt: previewSession.expiresAt.toISOString(),
    },
  });
});

// ─── Stop Preview ────────────────────────────────────────────
previewRoutes.post('/stop/:sessionId', async (c) => {
  const session = c.get('session');
  const sessionId = c.req.param('sessionId');
  const db = getDb();

  const previewSession = await db.query.previewSessions.findFirst({
    where: and(
      eq(previewSessions.id, sessionId),
      eq(previewSessions.userId, session.userId),
    ),
  });

  if (!previewSession) {
    throw new AppError(404, 'SESSION_NOT_FOUND', 'Preview session not found.');
  }

  if (previewSession.status === 'running') {
    const novita = getNovitaService();
    await novita.killSandbox(previewSession.novitaSandboxId);
  }

  await db.update(previewSessions)
    .set({ status: 'stopped' })
    .where(eq(previewSessions.id, sessionId));

  return c.json({
    success: true,
    data: { message: 'Preview stopped.' },
  });
});

// ─── Get Console Logs from Sandbox ───────────────────────────
previewRoutes.get('/logs/:sessionId', async (c) => {
  const session = c.get('session');
  const sessionId = c.req.param('sessionId');
  const db = getDb();

  const previewSession = await db.query.previewSessions.findFirst({
    where: and(
      eq(previewSessions.id, sessionId),
      eq(previewSessions.userId, session.userId),
      eq(previewSessions.status, 'running'),
    ),
  });

  if (!previewSession) {
    throw new AppError(404, 'SESSION_NOT_FOUND', 'Preview session not found or stopped.');
  }

  const novita = getNovitaService();
  const logs = await novita.getSandboxLogs(previewSession.novitaSandboxId);

  return c.json({
    success: true,
    data: { logs },
  });
});
