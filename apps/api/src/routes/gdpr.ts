// ============================================================
// SimpleBuild Pro — GDPR Compliance Routes
// Data export, data deletion, consent management
// Phase 5.3a: Security & Compliance
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '@simplebuildpro/db';
import {
  users,
  projects,
  projectFiles,
  projectAssets,
  deployments,
  usageLogs,
  aiConversations,
  aiMessages,
  oauthAccounts,
  orgMembers,
  refreshTokens,
} from '@simplebuildpro/db';
import { eq, and, sql } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth';
import type { AuthEnv } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import { auditLog, getAuditContext } from '../services/audit';
import { logger } from '../services/logger';
import { sendDataExportEmail } from '../services/email';
import { cache } from '../services/cache';

export const gdprRoutes = new Hono<AuthEnv>();
gdprRoutes.use('*', requireAuth);

// ─── Request Data Export (GDPR Article 20 — Data Portability) ────────────────
gdprRoutes.post('/export', async (c) => {
  const session = c.get('session');
  const db = getDb();

  // Rate limit: max 1 export per 24 hours
  const exportKey = `gdpr:export:${session.userId}`;
  const recentExport = await cache.get<boolean>(exportKey);
  if (recentExport) {
    throw new AppError(
      429,
      'EXPORT_RATE_LIMIT',
      'You can request a data export once every 24 hours.',
    );
  }

  // Collect all user data
  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
  });

  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');
  }

  // Gather all related data
  const [userProjects, userUsage, userConversations, userOAuth, userOrgMemberships] =
    await Promise.all([
      db.query.projects.findMany({
        where: eq(projects.ownerId, session.userId),
        with: {
          files: true,
          assets: true,
          deployments: true,
        },
      }),
      db.select().from(usageLogs).where(eq(usageLogs.userId, session.userId)).limit(10000),
      db.query.aiConversations.findMany({
        where: eq(aiConversations.userId, session.userId),
        with: { messages: true },
      }),
      db
        .select({
          id: oauthAccounts.id,
          provider: oauthAccounts.provider,
          providerAccountId: oauthAccounts.providerAccountId,
          createdAt: oauthAccounts.createdAt,
        })
        .from(oauthAccounts)
        .where(eq(oauthAccounts.userId, session.userId)),
      db.select().from(orgMembers).where(eq(orgMembers.userId, session.userId)),
    ]);

  // Get audit logs for this user
  const userAuditLogs = await db.execute(sql`
    SELECT action, resource_type, resource_id, ip_address, severity, created_at
    FROM audit_logs
    WHERE user_id = ${session.userId}
    ORDER BY created_at DESC
    LIMIT 5000
  `);

  // Build export payload
  const exportData = {
    exportedAt: new Date().toISOString(),
    exportVersion: '1.0',
    gdprArticle: 'Article 20 — Right to Data Portability',
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      plan: user.plan,
      emailVerified: user.emailVerified,
      billingStatus: user.billingStatus,
      creditBalanceCents: user.creditBalanceCents,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() || null,
      // Excluded: passwordHash, stripeCustomerId (sensitive)
    },
    projects: userProjects.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      description: p.description,
      status: p.status,
      settings: p.settings,
      createdAt: p.createdAt.toISOString(),
      files: p.files.map((f) => ({
        path: f.path,
        content: f.content, // Include actual file content
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
      })),
      assets: p.assets.map((a) => ({
        filename: a.filename,
        originalFilename: a.originalFilename,
        cdnUrl: a.cdnUrl,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
      })),
      deployments: p.deployments.map((d) => ({
        id: d.id,
        status: d.status,
        url: d.url,
        createdAt: d.createdAt.toISOString(),
      })),
    })),
    conversations: userConversations.map((conv) => ({
      id: conv.id,
      title: conv.title,
      createdAt: conv.createdAt.toISOString(),
      messages: conv.messages.map((m) => ({
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
    })),
    usageHistory: userUsage.map((u) => ({
      type: u.type,
      quantity: u.quantity,
      costCents: u.costCents,
      createdAt: u.createdAt.toISOString(),
    })),
    oauthConnections: userOAuth,
    organizationMemberships: userOrgMemberships,
    auditTrail: userAuditLogs,
  };

  // Log the export
  const ctx = getAuditContext(c);
  auditLog.log({
    ...ctx,
    action: 'admin.data_export',
    resourceType: 'user',
    resourceId: session.userId,
    metadata: {
      projectCount: userProjects.length,
      conversationCount: userConversations.length,
      usageRecords: userUsage.length,
    },
  });

  // Set rate limit
  await cache.set(exportKey, true, 86400); // 24 hours

  // Send email notification
  sendDataExportEmail(user.email, user.name).catch(() => {});

  // Return as downloadable JSON
  return new Response(JSON.stringify(exportData, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="simplebuildpro-data-export-${new Date().toISOString().split('T')[0]}.json"`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

// ─── Request Account Deletion (GDPR Article 17 — Right to Erasure) ──────────
const deletionSchema = z.object({
  confirmation: z.literal('DELETE MY ACCOUNT'),
  reason: z.string().max(500).optional(),
});

gdprRoutes.post('/delete-account', async (c) => {
  const session = c.get('session');
  const body = await c.req.json();
  const { confirmation, reason } = deletionSchema.parse(body);

  if (confirmation !== 'DELETE MY ACCOUNT') {
    throw new AppError(400, 'CONFIRMATION_REQUIRED', 'Please type "DELETE MY ACCOUNT" to confirm.');
  }

  const db = getDb();

  // Check if user is an org owner — must transfer ownership first
  const ownedOrgs = await db.execute(sql`
    SELECT o.id, o.name FROM organizations o WHERE o.owner_id = ${session.userId}
  `);

  if ((ownedOrgs as any[]).length > 0) {
    throw new AppError(
      400,
      'ORG_OWNER',
      'You own organizations. Please transfer ownership or delete them before deleting your account.',
    );
  }

  // Log deletion (before deleting — critical audit event)
  await auditLog.logSync({
    userId: session.userId,
    action: 'admin.data_delete',
    resourceType: 'user',
    resourceId: session.userId,
    metadata: { reason: reason || 'User requested account deletion' },
    ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
    userAgent: c.req.header('user-agent') || 'unknown',
    organizationId: session.organizationId,
    severity: 'critical',
  });

  // Delete in order (cascade handles most, but be explicit for safety)
  try {
    // 1. Delete AI conversations and messages
    const userConversations = await db.query.aiConversations.findMany({
      where: eq(aiConversations.userId, session.userId),
    });
    for (const conv of userConversations) {
      await db.delete(aiMessages).where(eq(aiMessages.conversationId, conv.id));
    }
    await db.delete(aiConversations).where(eq(aiConversations.userId, session.userId));

    // 2. Delete projects (cascade deletes files, assets, versions, deployments)
    await db.delete(projects).where(eq(projects.ownerId, session.userId));

    // 3. Delete usage logs
    await db.delete(usageLogs).where(eq(usageLogs.userId, session.userId));

    // 4. Delete OAuth accounts
    await db.delete(oauthAccounts).where(eq(oauthAccounts.userId, session.userId));

    // 5. Delete refresh tokens
    await db.delete(refreshTokens).where(eq(refreshTokens.userId, session.userId));

    // 6. Remove from organizations
    await db.delete(orgMembers).where(eq(orgMembers.userId, session.userId));

    // 7. Anonymize audit logs (keep for compliance, but remove PII)
    await db.execute(sql`
      UPDATE audit_logs
      SET user_id = NULL, ip_address = NULL, user_agent = NULL,
          metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{anonymized}', 'true'::jsonb)
      WHERE user_id = ${session.userId}
    `);

    // 8. Finally delete the user
    await db.delete(users).where(eq(users.id, session.userId));

    // 9. Invalidate all caches
    await cache.invalidateUser(session.userId);

    logger.info('Account deleted (GDPR)', {
      userId: session.userId,
      reason: reason || 'user_requested',
    });

    // TODO: Queue GCS cleanup for user's assets/builds/deploys

    return c.json({
      success: true,
      data: {
        message: 'Your account and all associated data have been permanently deleted.',
        deletedAt: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    logger.error('Account deletion failed', {
      userId: session.userId,
      error: err.message,
    });
    throw new AppError(500, 'DELETION_FAILED', 'Account deletion failed. Please contact support.');
  }
});

// ─── Get Data Processing Summary ─────────────────────────────────────────────
// GDPR Article 15 — Right of Access
gdprRoutes.get('/data-summary', async (c) => {
  const session = c.get('session');
  const db = getDb();

  const [projectCount] = (await db.execute(sql`
    SELECT COUNT(*) as count FROM projects WHERE owner_id = ${session.userId}
  `)) as any[];

  const [fileCount] = (await db.execute(sql`
    SELECT COUNT(*) as count FROM project_files pf
    JOIN projects p ON pf.project_id = p.id
    WHERE p.owner_id = ${session.userId}
  `)) as any[];

  const [deployCount] = (await db.execute(sql`
    SELECT COUNT(*) as count FROM deployments WHERE created_by = ${session.userId}
  `)) as any[];

  const [conversationCount] = (await db.execute(sql`
    SELECT COUNT(*) as count FROM ai_conversations WHERE user_id = ${session.userId}
  `)) as any[];

  const [usageCount] = (await db.execute(sql`
    SELECT COUNT(*) as count FROM usage_logs WHERE user_id = ${session.userId}
  `)) as any[];

  const [auditCount] = (await db.execute(sql`
    SELECT COUNT(*) as count FROM audit_logs WHERE user_id = ${session.userId}
  `)) as any[];

  return c.json({
    success: true,
    data: {
      gdprInfo: {
        dataController: 'SimpleBuild Pro',
        contactEmail: 'privacy@simplebuildpro.com',
        legalBasis: 'Contract performance (Art. 6(1)(b) GDPR)',
        retentionPolicy:
          'Data retained while account is active. Deleted within 30 days of account deletion.',
        thirdPartyProcessors: [
          'Google Cloud Platform (hosting, storage)',
          'Anthropic (AI processing)',
          'Stripe (payment processing)',
          'Resend (transactional email)',
        ],
      },
      dataSummary: {
        projects: Number(projectCount?.count || 0),
        files: Number(fileCount?.count || 0),
        deployments: Number(deployCount?.count || 0),
        aiConversations: Number(conversationCount?.count || 0),
        usageRecords: Number(usageCount?.count || 0),
        auditLogEntries: Number(auditCount?.count || 0),
      },
      yourRights: [
        'Right of Access (Art. 15) — GET /api/v1/gdpr/data-summary',
        'Right to Data Portability (Art. 20) — POST /api/v1/gdpr/export',
        'Right to Erasure (Art. 17) — POST /api/v1/gdpr/delete-account',
        'Right to Rectification (Art. 16) — PATCH /api/v1/auth/profile',
      ],
    },
  });
});
