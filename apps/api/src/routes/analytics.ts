// ============================================================
// SimpleBuild Pro — Enhanced Admin Analytics Routes
// Revenue dashboard, usage analytics, platform SLIs
// Phase 4.3: Growth & Optimization
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
  aiConversations,
} from '@simplebuildpro/db';
import { eq, desc, sql, count, sum, avg, gte, lte, and, between } from 'drizzle-orm';
import { AppError } from '../middleware/error-handler';
import { requireAuth } from '../middleware/auth';
import type { AuthEnv } from '../middleware/auth';
import { rateLimiter } from '../middleware/rate-limiter';
import { cache, CACHE_KEYS, CACHE_TTL } from '../services/cache';
import { metricsCollector } from '../services/monitoring';

export const analyticsRoutes = new Hono<AuthEnv>();

analyticsRoutes.use('*', requireAuth);
analyticsRoutes.use('*', rateLimiter('api'));

// Admin guard
analyticsRoutes.use('*', async (c, next) => {
  const session = c.get('session');
  if (session.plan !== 'enterprise' && session.plan !== 'business') {
    throw new AppError(
      403,
      'FORBIDDEN',
      'Analytics access requires a Business or Enterprise plan.',
    );
  }
  await next();
});

// ─── Revenue Dashboard ──────────────────────────────────────────────────────
analyticsRoutes.get('/revenue', async (c) => {
  const period = c.req.query('period') || '30d'; // 7d, 30d, 90d
  const db = getDb();

  const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const cacheKey = `analytics:revenue:${period}`;
  const cached = await cache.get<any>(cacheKey);
  if (cached) return c.json({ success: true, data: cached });

  // Daily revenue from usage logs (billed amounts)
  const dailyRevenue = await db.execute(sql`
    SELECT
      DATE(created_at) as date,
      SUM(cost_cents) as revenue_cents,
      COUNT(DISTINCT user_id) as paying_users,
      COUNT(*) as transactions
    FROM usage_logs
    WHERE created_at >= ${startDate}
      AND cost_cents > 0
    GROUP BY DATE(created_at)
    ORDER BY date DESC
  `);

  // Total revenue for period
  const [totalRevenue] = await db
    .select({
      total: sum(usageLogs.costCents),
      transactions: count(),
    })
    .from(usageLogs)
    .where(and(gte(usageLogs.createdAt, startDate), sql`${usageLogs.costCents} > 0`));

  // Revenue by type (ai_tokens, builds, deploys, previews)
  const revenueByType = await db.execute(sql`
    SELECT
      type,
      SUM(cost_cents) as revenue_cents,
      COUNT(*) as count
    FROM usage_logs
    WHERE created_at >= ${startDate}
      AND cost_cents > 0
    GROUP BY type
    ORDER BY revenue_cents DESC
  `);

  // MRR estimate (last 30 days annualized)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [mrrData] = await db
    .select({
      monthly: sum(usageLogs.costCents),
    })
    .from(usageLogs)
    .where(and(gte(usageLogs.createdAt, thirtyDaysAgo), sql`${usageLogs.costCents} > 0`));

  const mrrCents = Number(mrrData?.monthly || 0);
  const arrCents = mrrCents * 12;

  // ARPU (Average Revenue Per User)
  const [activeUsers] = await db
    .select({ count: sql<number>`COUNT(DISTINCT user_id)` })
    .from(usageLogs)
    .where(and(gte(usageLogs.createdAt, thirtyDaysAgo), sql`${usageLogs.costCents} > 0`));

  const arpu = activeUsers.count > 0 ? Math.round(mrrCents / activeUsers.count) : 0;

  const result = {
    period,
    totalRevenueCents: Number(totalRevenue?.total || 0),
    totalTransactions: Number(totalRevenue?.transactions || 0),
    mrr: { cents: mrrCents, formatted: `$${(mrrCents / 100).toFixed(2)}` },
    arr: { cents: arrCents, formatted: `$${(arrCents / 100).toFixed(2)}` },
    arpu: { cents: arpu, formatted: `$${(arpu / 100).toFixed(2)}` },
    payingUsers: activeUsers.count,
    revenueByType: (revenueByType as any[]).map((r: any) => ({
      type: r.type,
      revenueCents: Number(r.revenue_cents),
      count: Number(r.count),
    })),
    dailyRevenue: (dailyRevenue as any[]).map((d: any) => ({
      date: d.date,
      revenueCents: Number(d.revenue_cents),
      payingUsers: Number(d.paying_users),
      transactions: Number(d.transactions),
    })),
  };

  await cache.set(cacheKey, result, CACHE_TTL.EXTENDED);
  return c.json({ success: true, data: result });
});

// ─── Usage Analytics ─────────────────────────────────────────────────────────
analyticsRoutes.get('/usage', async (c) => {
  const period = c.req.query('period') || '30d';
  const db = getDb();

  const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const cacheKey = `analytics:usage:${period}`;
  const cached = await cache.get<any>(cacheKey);
  if (cached) return c.json({ success: true, data: cached });

  // Daily active users (DAU)
  const dauData = await db.execute(sql`
    SELECT
      DATE(created_at) as date,
      COUNT(DISTINCT user_id) as active_users
    FROM usage_logs
    WHERE created_at >= ${startDate}
    GROUP BY DATE(created_at)
    ORDER BY date DESC
  `);

  // Feature usage breakdown
  const featureUsage = await db.execute(sql`
    SELECT
      type,
      COUNT(*) as count,
      COUNT(DISTINCT user_id) as unique_users,
      SUM(quantity) as total_quantity
    FROM usage_logs
    WHERE created_at >= ${startDate}
    GROUP BY type
    ORDER BY count DESC
  `);

  // AI usage stats
  const [aiStats] = (await db.execute(sql`
    SELECT
      COUNT(*) as total_conversations,
      COUNT(DISTINCT user_id) as ai_users,
      SUM(CASE WHEN type = 'ai_tokens' THEN quantity ELSE 0 END) as total_tokens
    FROM usage_logs
    WHERE created_at >= ${startDate}
      AND type = 'ai_tokens'
  `)) as any[];

  // Deploy stats
  const deployStats = await db.execute(sql`
    SELECT
      status,
      COUNT(*) as count,
      AVG(build_duration_ms) as avg_build_ms
    FROM deployments
    WHERE created_at >= ${startDate}
    GROUP BY status
  `);

  // User funnel: signup → project → build → deploy
  const [signups] = await db
    .select({ count: count() })
    .from(users)
    .where(gte(users.createdAt, startDate));

  const [withProjects] = (await db.execute(sql`
    SELECT COUNT(DISTINCT owner_id) as count
    FROM projects
    WHERE created_at >= ${startDate}
  `)) as any[];

  const [withDeploys] = (await db.execute(sql`
    SELECT COUNT(DISTINCT created_by) as count
    FROM deployments
    WHERE created_at >= ${startDate}
      AND status = 'live'
  `)) as any[];

  const result = {
    period,
    dau: (dauData as any[]).map((d: any) => ({
      date: d.date,
      activeUsers: Number(d.active_users),
    })),
    avgDau:
      (dauData as any[]).length > 0
        ? Math.round(
            (dauData as any[]).reduce((sum: number, d: any) => sum + Number(d.active_users), 0) /
              (dauData as any[]).length,
          )
        : 0,
    featureUsage: (featureUsage as any[]).map((f: any) => ({
      type: f.type,
      count: Number(f.count),
      uniqueUsers: Number(f.unique_users),
      totalQuantity: Number(f.total_quantity),
    })),
    ai: {
      totalConversations: Number(aiStats?.total_conversations || 0),
      uniqueUsers: Number(aiStats?.ai_users || 0),
      totalTokens: Number(aiStats?.total_tokens || 0),
    },
    deployments: (deployStats as any[]).map((d: any) => ({
      status: d.status,
      count: Number(d.count),
      avgBuildMs: Math.round(Number(d.avg_build_ms || 0)),
    })),
    funnel: {
      signups: signups.count,
      createdProject: Number(withProjects?.count || 0),
      deployed: Number(withDeploys?.count || 0),
      conversionRate:
        signups.count > 0
          ? Math.round((Number(withDeploys?.count || 0) / signups.count) * 10000) / 100
          : 0,
    },
  };

  await cache.set(cacheKey, result, CACHE_TTL.EXTENDED);
  return c.json({ success: true, data: result });
});

// ─── Platform Health / SLIs ─────────────────────────────────────────────────
analyticsRoutes.get('/platform-health', async (c) => {
  const metrics = metricsCollector.getMetrics();
  const cacheStats = cache.getStats();

  // Compute SLIs
  const totalRequests = metrics.requests.total;
  const errorRequests = metrics.errors.total;
  const availability =
    totalRequests > 0
      ? Math.round(((totalRequests - errorRequests) / totalRequests) * 10000) / 100
      : 100;

  const result = {
    timestamp: new Date().toISOString(),
    slis: {
      availability: `${availability}%`,
      p50Latency: `${metrics.latency.p50}ms`,
      p95Latency: `${metrics.latency.p95}ms`,
      p99Latency: `${metrics.latency.p99}ms`,
      errorRate: `${metrics.errors.rate}%`,
      errorBudgetRemaining: Math.max(0, 99.9 - (100 - availability)),
    },
    requests: {
      total: metrics.requests.total,
      byStatus: metrics.requests.byStatus,
      byMethod: metrics.requests.byMethod,
      topPaths: metrics.requests.byPath,
    },
    cache: {
      ...cacheStats,
      hitRateFormatted: `${cacheStats.hitRate}%`,
    },
    system: {
      uptime: metrics.uptime,
      uptimeFormatted: formatUptime(metrics.uptime),
      startTime: metrics.startTime,
      memory: process.memoryUsage(),
    },
    recentErrors: metrics.errors.recent,
  };

  return c.json({ success: true, data: result });
});

// ─── User Cohort Analysis ────────────────────────────────────────────────────
analyticsRoutes.get('/cohorts', async (c) => {
  const db = getDb();

  const cacheKey = 'analytics:cohorts';
  const cached = await cache.get<any>(cacheKey);
  if (cached) return c.json({ success: true, data: cached });

  // Weekly cohorts: signup week → % still active after 1w, 2w, 4w
  const cohorts = await db.execute(sql`
    WITH user_cohorts AS (
      SELECT
        id,
        DATE_TRUNC('week', created_at) as cohort_week
      FROM users
      WHERE created_at >= NOW() - INTERVAL '12 weeks'
    ),
    activity AS (
      SELECT
        user_id,
        DATE_TRUNC('week', created_at) as activity_week
      FROM usage_logs
      WHERE created_at >= NOW() - INTERVAL '12 weeks'
      GROUP BY user_id, DATE_TRUNC('week', created_at)
    )
    SELECT
      uc.cohort_week,
      COUNT(DISTINCT uc.id) as cohort_size,
      COUNT(DISTINCT CASE
        WHEN a.activity_week = uc.cohort_week + INTERVAL '1 week'
        THEN uc.id END) as week1_retained,
      COUNT(DISTINCT CASE
        WHEN a.activity_week = uc.cohort_week + INTERVAL '2 weeks'
        THEN uc.id END) as week2_retained,
      COUNT(DISTINCT CASE
        WHEN a.activity_week = uc.cohort_week + INTERVAL '4 weeks'
        THEN uc.id END) as week4_retained
    FROM user_cohorts uc
    LEFT JOIN activity a ON uc.id = a.user_id
    GROUP BY uc.cohort_week
    ORDER BY uc.cohort_week DESC
    LIMIT 12
  `);

  const result = {
    cohorts: (cohorts as any[]).map((c: any) => ({
      week: c.cohort_week,
      size: Number(c.cohort_size),
      week1Retention:
        c.cohort_size > 0
          ? Math.round((Number(c.week1_retained) / Number(c.cohort_size)) * 100)
          : 0,
      week2Retention:
        c.cohort_size > 0
          ? Math.round((Number(c.week2_retained) / Number(c.cohort_size)) * 100)
          : 0,
      week4Retention:
        c.cohort_size > 0
          ? Math.round((Number(c.week4_retained) / Number(c.cohort_size)) * 100)
          : 0,
    })),
  };

  await cache.set(cacheKey, result, CACHE_TTL.EXTENDED);
  return c.json({ success: true, data: result });
});

// ─── Usage Forecasting ──────────────────────────────────────────────────────
analyticsRoutes.get('/forecast', async (c) => {
  const userId = c.req.query('userId');
  const db = getDb();

  // Get last 30 days of daily spending
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const conditions = [gte(usageLogs.createdAt, thirtyDaysAgo)];
  if (userId) {
    conditions.push(eq(usageLogs.userId, userId));
  }

  const dailySpend = await db.execute(sql`
    SELECT
      DATE(created_at) as date,
      SUM(cost_cents) as daily_cost
    FROM usage_logs
    WHERE created_at >= ${thirtyDaysAgo}
      ${userId ? sql`AND user_id = ${userId}` : sql``}
      AND cost_cents > 0
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `);

  const spendValues = (dailySpend as any[]).map((d: any) => Number(d.daily_cost));

  // Simple linear regression for forecast
  const n = spendValues.length;
  if (n < 7) {
    return c.json({
      success: true,
      data: {
        forecast: null,
        reason: 'Insufficient data (need at least 7 days)',
        currentAvgDaily: n > 0 ? Math.round(spendValues.reduce((a, b) => a + b, 0) / n) : 0,
      },
    });
  }

  // Calculate trend
  const sumX = (n * (n - 1)) / 2;
  const sumY = spendValues.reduce((a, b) => a + b, 0);
  const sumXY = spendValues.reduce((sum, y, x) => sum + x * y, 0);
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // Forecast next 30 days
  const forecast30Days = Array.from({ length: 30 }, (_, i) => {
    const forecastDay = n + i;
    const value = Math.max(0, Math.round(intercept + slope * forecastDay));
    const date = new Date(Date.now() + (i + 1) * 24 * 60 * 60 * 1000);
    return { date: date.toISOString().split('T')[0], forecastCents: value };
  });

  const avgDaily = Math.round(sumY / n);
  const forecastMonthly = forecast30Days.reduce((sum, d) => sum + d.forecastCents, 0);

  return c.json({
    success: true,
    data: {
      currentAvgDailyCents: avgDaily,
      currentAvgDailyFormatted: `$${(avgDaily / 100).toFixed(2)}`,
      trend: slope > 0 ? 'increasing' : slope < 0 ? 'decreasing' : 'stable',
      trendPerDay: Math.round(slope),
      forecastNext30DaysCents: forecastMonthly,
      forecastNext30DaysFormatted: `$${(forecastMonthly / 100).toFixed(2)}`,
      dailyForecast: forecast30Days,
      historicalDays: n,
    },
  });
});

// ─── Helper ──────────────────────────────────────────────────────────────────
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${Math.floor(seconds % 60)}s`);
  return parts.join(' ');
}
