// ============================================================
// SimpleBuild Pro — Admin Routes
// Admin dashboard data: users, projects, deployments, usage
// Restricted to enterprise plan users (admin role)
// ============================================================

import { Hono } from 'hono';
import { getDb } from '@simplebuildpro/db';
import {
  users,
  projects,
  deployments,
  usageLogs,
  subscriptions,
  organizations,
} from '@simplebuildpro/db';
import { eq, desc, sql, count, sum, gte } from 'drizzle-orm';
import { AppError } from '../middleware/error-handler';
import { requireAuth } from '../middleware/auth';
import type { AuthEnv } from '../middleware/auth';
import { rateLimiter } from '../middleware/rate-limiter';
import { getRateLimiterHealth } from '../middleware/rate-limiter';

export const adminRoutes = new Hono<AuthEnv>();

adminRoutes.use('*', requireAuth);
adminRoutes.use('*', rateLimiter('api'));

// Admin guard: only enterprise plan or specific admin flag
adminRoutes.use('*', async (c, next) => {
  const session = c.get('session');
  // In production, add a proper admin check (e.g., isAdmin flag, specific email whitelist)
  if (session.plan !== 'enterprise' && session.plan !== 'business') {
    throw new AppError(403, 'FORBIDDEN', 'Admin access requires a Business or Enterprise plan.');
  }
  await next();
});

// ─── Dashboard Overview ──────────────────────────────────────
adminRoutes.get('/overview', async (c) => {
  const db = getDb();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Get counts
  const [userCount] = await db.select({ count: count() }).from(users);
  const [projectCount] = await db.select({ count: count() }).from(projects);
  const [deploymentCount] = await db.select({ count: count() }).from(deployments);
  const [orgCount] = await db.select({ count: count() }).from(organizations);

  // Recent signups (last 30 days)
  const [recentSignups] = await db
    .select({ count: count() })
    .from(users)
    .where(gte(users.createdAt, thirtyDaysAgo));

  // Recent deployments (last 30 days)
  const [recentDeploys] = await db
    .select({ count: count() })
    .from(deployments)
    .where(gte(deployments.createdAt, thirtyDaysAgo));

  // Plan distribution
  const planDistribution = await db
    .select({
      plan: users.plan,
      count: count(),
    })
    .from(users)
    .groupBy(users.plan);

  // AI token usage this month
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [aiUsage] = await db
    .select({
      totalTokens: sum(usageLogs.quantity),
    })
    .from(usageLogs)
    .where(sql`${usageLogs.type} = 'ai_tokens' AND ${usageLogs.createdAt} >= ${startOfMonth}`);

  // Rate limiter health
  const rateLimiterStatus = await getRateLimiterHealth();

  return c.json({
    success: true,
    data: {
      totals: {
        users: userCount.count,
        projects: projectCount.count,
        deployments: deploymentCount.count,
        organizations: orgCount.count,
      },
      last30Days: {
        newUsers: recentSignups.count,
        deployments: recentDeploys.count,
      },
      planDistribution: planDistribution.reduce(
        (acc, p) => {
          acc[p.plan] = p.count;
          return acc;
        },
        {} as Record<string, number>,
      ),
      aiTokensThisMonth: Number(aiUsage?.totalTokens || 0),
      infrastructure: {
        rateLimiter: rateLimiterStatus,
      },
    },
  });
});

// ─── List Users ──────────────────────────────────────────────
adminRoutes.get('/users', async (c) => {
  const page = parseInt(c.req.query('page') || '1');
  const pageSize = parseInt(c.req.query('pageSize') || '50');
  const offset = (page - 1) * pageSize;

  const db = getDb();

  const userList = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      plan: users.plan,
      emailVerified: users.emailVerified,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(pageSize)
    .offset(offset);

  const [total] = await db.select({ count: count() }).from(users);

  return c.json({
    success: true,
    data: {
      items: userList,
      total: total.count,
      page,
      pageSize,
      hasMore: offset + pageSize < total.count,
    },
  });
});

// ─── List Projects ───────────────────────────────────────────
adminRoutes.get('/projects', async (c) => {
  const page = parseInt(c.req.query('page') || '1');
  const pageSize = parseInt(c.req.query('pageSize') || '50');
  const offset = (page - 1) * pageSize;

  const db = getDb();

  const projectList = await db
    .select({
      id: projects.id,
      name: projects.name,
      slug: projects.slug,
      status: projects.status,
      ownerId: projects.ownerId,
      lastDeployedAt: projects.lastDeployedAt,
      createdAt: projects.createdAt,
    })
    .from(projects)
    .orderBy(desc(projects.createdAt))
    .limit(pageSize)
    .offset(offset);

  const [total] = await db.select({ count: count() }).from(projects);

  return c.json({
    success: true,
    data: {
      items: projectList,
      total: total.count,
      page,
      pageSize,
      hasMore: offset + pageSize < total.count,
    },
  });
});

// ─── Recent Deployments ──────────────────────────────────────
adminRoutes.get('/deployments', async (c) => {
  const page = parseInt(c.req.query('page') || '1');
  const pageSize = parseInt(c.req.query('pageSize') || '50');
  const offset = (page - 1) * pageSize;

  const db = getDb();

  const deployList = await db
    .select({
      id: deployments.id,
      projectId: deployments.projectId,
      status: deployments.status,
      url: deployments.url,
      lighthouseScore: deployments.lighthouseScore,
      buildDurationMs: deployments.buildDurationMs,
      createdBy: deployments.createdBy,
      createdAt: deployments.createdAt,
    })
    .from(deployments)
    .orderBy(desc(deployments.createdAt))
    .limit(pageSize)
    .offset(offset);

  const [total] = await db.select({ count: count() }).from(deployments);

  return c.json({
    success: true,
    data: {
      items: deployList,
      total: total.count,
      page,
      pageSize,
      hasMore: offset + pageSize < total.count,
    },
  });
});

// ─── Audit Logs ──────────────────────────────────────────────
adminRoutes.get('/audit-logs', async (c) => {
  const page = parseInt(c.req.query('page') || '1');
  const pageSize = parseInt(c.req.query('pageSize') || '100');
  const offset = (page - 1) * pageSize;

  const db = getDb();

  const logs = await db.execute(sql`
    SELECT al.*, u.email as user_email, u.name as user_name
    FROM audit_logs al
    LEFT JOIN users u ON al.user_id = u.id
    ORDER BY al.created_at DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `);

  const [total] = (await db.execute(
    sql`SELECT COUNT(*) as count FROM audit_logs`,
  )) as unknown as any[];

  return c.json({
    success: true,
    data: {
      items: logs,
      total: Number(total?.count || 0),
      page,
      pageSize,
    },
  });
});

// ─── System Health ───────────────────────────────────────────
adminRoutes.get('/health', async (c) => {
  const db = getDb();

  // DB health
  let dbHealth: { ok: boolean; latencyMs: number } = { ok: false, latencyMs: 0 };
  try {
    const start = Date.now();
    await db.execute(sql`SELECT 1`);
    dbHealth = { ok: true, latencyMs: Date.now() - start };
  } catch {
    dbHealth = { ok: false, latencyMs: 0 };
  }

  // Rate limiter health
  const rateLimiterHealth = await getRateLimiterHealth();

  return c.json({
    success: true,
    data: {
      status: dbHealth.ok ? 'healthy' : 'degraded',
      database: dbHealth,
      rateLimiter: rateLimiterHealth,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      nodeVersion: process.version,
      timestamp: new Date().toISOString(),
    },
  });
});
