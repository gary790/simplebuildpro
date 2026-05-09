// ============================================================
// SimpleBuild Pro — Billing Enhancements
// Prepaid credits, volume discounts, usage forecasting
// Phase 4.5: Growth & Optimization
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '@simplebuildpro/db';
import { users, usageLogs } from '@simplebuildpro/db';
import { eq, and, gte, sum, sql } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth';
import type { AuthEnv } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import { cache, CACHE_KEYS, CACHE_TTL } from '../services/cache';
import { logger } from '../services/logger';

export const billingEnhancedRoutes = new Hono<AuthEnv>();
billingEnhancedRoutes.use('*', requireAuth);

// ─── Volume Discount Tiers ───────────────────────────────────────────────────
const VOLUME_DISCOUNTS = [
  { minSpendCents: 0, maxSpendCents: 5000, discount: 0, label: 'Standard' },
  { minSpendCents: 5000, maxSpendCents: 10000, discount: 5, label: 'Bronze (5% off)' },
  { minSpendCents: 10000, maxSpendCents: 25000, discount: 10, label: 'Silver (10% off)' },
  { minSpendCents: 25000, maxSpendCents: 50000, discount: 15, label: 'Gold (15% off)' },
  { minSpendCents: 50000, maxSpendCents: Infinity, discount: 20, label: 'Platinum (20% off)' },
] as const;

// ─── Prepaid Credit Packages ─────────────────────────────────────────────────
const CREDIT_PACKAGES = [
  { id: 'credits-10', amountCents: 1000, bonusCents: 0, label: '$10 Credits' },
  { id: 'credits-25', amountCents: 2500, bonusCents: 250, label: '$25 Credits (+$2.50 bonus)' },
  { id: 'credits-50', amountCents: 5000, bonusCents: 750, label: '$50 Credits (+$7.50 bonus)' },
  { id: 'credits-100', amountCents: 10000, bonusCents: 2000, label: '$100 Credits (+$20 bonus)' },
  {
    id: 'credits-250',
    amountCents: 25000,
    bonusCents: 6250,
    label: '$250 Credits (+$62.50 bonus)',
  },
] as const;

// ─── Get Credit Packages ─────────────────────────────────────────────────────
billingEnhancedRoutes.get('/credits/packages', async (c) => {
  return c.json({
    success: true,
    data: {
      packages: CREDIT_PACKAGES.map((pkg) => ({
        ...pkg,
        totalCreditsCents: pkg.amountCents + pkg.bonusCents,
        bonusPercent: pkg.bonusCents > 0 ? Math.round((pkg.bonusCents / pkg.amountCents) * 100) : 0,
      })),
    },
  });
});

// ─── Purchase Credits ────────────────────────────────────────────────────────
const purchaseCreditsSchema = z.object({
  packageId: z.string(),
});

billingEnhancedRoutes.post('/credits/purchase', async (c) => {
  const session = c.get('session');
  const body = await c.req.json();
  const { packageId } = purchaseCreditsSchema.parse(body);

  const pkg = CREDIT_PACKAGES.find((p) => p.id === packageId);
  if (!pkg) {
    throw new AppError(400, 'INVALID_PACKAGE', 'Invalid credit package ID.');
  }

  const db = getDb();

  // Verify user has payment method
  const [user] = await db
    .select({
      paymentMethodAdded: users.paymentMethodAdded,
      creditBalanceCents: users.creditBalanceCents,
    })
    .from(users)
    .where(eq(users.id, session.userId));

  if (!user?.paymentMethodAdded) {
    throw new AppError(
      402,
      'PAYMENT_REQUIRED',
      'Please add a payment method before purchasing credits.',
    );
  }

  // TODO: Create Stripe charge for pkg.amountCents
  // For now, directly credit the account (Stripe integration pending)
  const totalCredits = pkg.amountCents + pkg.bonusCents;
  const newBalance = (user.creditBalanceCents || 0) + totalCredits;

  await db
    .update(users)
    .set({
      creditBalanceCents: newBalance,
      updatedAt: new Date(),
    })
    .where(eq(users.id, session.userId));

  // Log the credit purchase
  logger.info('Credit purchase', {
    userId: session.userId,
    packageId,
    amountCents: pkg.amountCents,
    bonusCents: pkg.bonusCents,
    totalCredits,
    newBalance,
  });

  // Invalidate user cache
  await cache.invalidateUser(session.userId);

  return c.json({
    success: true,
    data: {
      purchased: {
        packageId,
        amountCharged: pkg.amountCents,
        creditsAdded: totalCredits,
        bonusCredits: pkg.bonusCents,
      },
      balance: {
        cents: newBalance,
        formatted: `$${(newBalance / 100).toFixed(2)}`,
      },
    },
  });
});

// ─── Get Credit Balance ──────────────────────────────────────────────────────
billingEnhancedRoutes.get('/credits/balance', async (c) => {
  const session = c.get('session');
  const db = getDb();

  const [user] = await db
    .select({ creditBalanceCents: users.creditBalanceCents })
    .from(users)
    .where(eq(users.id, session.userId));

  const balance = user?.creditBalanceCents || 0;

  return c.json({
    success: true,
    data: {
      balanceCents: balance,
      balanceFormatted: `$${(balance / 100).toFixed(2)}`,
    },
  });
});

// ─── Get Volume Discount Tier ────────────────────────────────────────────────
billingEnhancedRoutes.get('/discount-tier', async (c) => {
  const session = c.get('session');
  const db = getDb();

  // Calculate monthly spend
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [monthlySpend] = await db
    .select({ total: sum(usageLogs.costCents) })
    .from(usageLogs)
    .where(and(eq(usageLogs.userId, session.userId), gte(usageLogs.createdAt, startOfMonth)));

  const spendCents = Number(monthlySpend?.total || 0);

  // Determine current tier
  const currentTier =
    VOLUME_DISCOUNTS.find(
      (tier) => spendCents >= tier.minSpendCents && spendCents < tier.maxSpendCents,
    ) || VOLUME_DISCOUNTS[0];

  // Next tier
  const currentIdx = VOLUME_DISCOUNTS.indexOf(currentTier);
  const nextTier =
    currentIdx < VOLUME_DISCOUNTS.length - 1 ? VOLUME_DISCOUNTS[currentIdx + 1] : null;

  return c.json({
    success: true,
    data: {
      currentTier: {
        label: currentTier.label,
        discount: currentTier.discount,
        monthlySpendCents: spendCents,
        monthlySpendFormatted: `$${(spendCents / 100).toFixed(2)}`,
      },
      nextTier: nextTier
        ? {
            label: nextTier.label,
            discount: nextTier.discount,
            spendNeededCents: nextTier.minSpendCents - spendCents,
            spendNeededFormatted: `$${((nextTier.minSpendCents - spendCents) / 100).toFixed(2)}`,
          }
        : null,
      allTiers: VOLUME_DISCOUNTS.map((t) => ({
        label: t.label,
        discount: t.discount,
        minSpend: `$${(t.minSpendCents / 100).toFixed(2)}`,
        active: t === currentTier,
      })),
    },
  });
});

// ─── Usage Forecast (Per-User) ───────────────────────────────────────────────
billingEnhancedRoutes.get('/forecast', async (c) => {
  const session = c.get('session');
  const db = getDb();

  // Get last 30 days of spending for this user
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const dailySpend = await db.execute(sql`
    SELECT
      DATE(created_at) as date,
      SUM(cost_cents) as daily_cost,
      COUNT(*) as actions
    FROM usage_logs
    WHERE user_id = ${session.userId}
      AND created_at >= ${thirtyDaysAgo}
      AND cost_cents > 0
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `);

  const spendValues = (dailySpend as any[]).map((d: any) => Number(d.daily_cost));
  const n = spendValues.length;

  if (n < 3) {
    return c.json({
      success: true,
      data: {
        forecast: null,
        reason: 'Insufficient usage history (need at least 3 active days)',
        suggestion: 'Keep using SimpleBuild Pro to see your spending forecast!',
      },
    });
  }

  // Simple moving average + trend
  const avgDaily = Math.round(spendValues.reduce((a, b) => a + b, 0) / n);
  const recent7 = spendValues.slice(-7);
  const avgRecent =
    recent7.length > 0 ? Math.round(recent7.reduce((a, b) => a + b, 0) / recent7.length) : avgDaily;

  // Trend direction
  const firstHalf = spendValues.slice(0, Math.floor(n / 2));
  const secondHalf = spendValues.slice(Math.floor(n / 2));
  const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
  const trend =
    secondAvg > firstAvg * 1.1
      ? 'increasing'
      : secondAvg < firstAvg * 0.9
        ? 'decreasing'
        : 'stable';

  // Project remaining month
  const today = new Date();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const daysRemaining = daysInMonth - today.getDate();
  const projectedRemainder = avgRecent * daysRemaining;

  // Current month spend so far
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [currentMonth] = await db
    .select({ total: sum(usageLogs.costCents) })
    .from(usageLogs)
    .where(
      and(
        eq(usageLogs.userId, session.userId),
        gte(usageLogs.createdAt, startOfMonth),
        sql`${usageLogs.costCents} > 0`,
      ),
    );

  const monthToDate = Number(currentMonth?.total || 0);
  const projectedTotal = monthToDate + projectedRemainder;

  // Volume discount that would apply
  const applicableTier =
    VOLUME_DISCOUNTS.find(
      (tier) => projectedTotal >= tier.minSpendCents && projectedTotal < tier.maxSpendCents,
    ) || VOLUME_DISCOUNTS[0];

  const savings = Math.round(projectedTotal * (applicableTier.discount / 100));

  return c.json({
    success: true,
    data: {
      avgDailyCents: avgDaily,
      avgDailyFormatted: `$${(avgDaily / 100).toFixed(2)}`,
      avgRecent7Days: avgRecent,
      trend,
      monthToDateCents: monthToDate,
      monthToDateFormatted: `$${(monthToDate / 100).toFixed(2)}`,
      projectedMonthTotalCents: Math.round(projectedTotal),
      projectedMonthTotalFormatted: `$${(projectedTotal / 100).toFixed(2)}`,
      daysRemaining,
      projectedTier: applicableTier.label,
      projectedSavingsCents: savings,
      projectedSavingsFormatted: `$${(savings / 100).toFixed(2)}`,
      activeDays: n,
      history: (dailySpend as any[]).slice(-14).map((d: any) => ({
        date: d.date,
        costCents: Number(d.daily_cost),
        actions: Number(d.actions),
      })),
    },
  });
});

// ─── Apply Promo Code ────────────────────────────────────────────────────────
const promoCodeSchema = z.object({
  code: z.string().min(3).max(32),
});

billingEnhancedRoutes.post('/promo-code', async (c) => {
  const session = c.get('session');
  const body = await c.req.json();
  const { code } = promoCodeSchema.parse(body);

  const db = getDb();

  // Check promo codes table (simple implementation — could be expanded)
  // For now, hardcode a few launch codes
  const PROMO_CODES: Record<
    string,
    { creditsCents: number; maxUses: number; description: string }
  > = {
    WELCOME10: { creditsCents: 1000, maxUses: 1, description: 'Welcome bonus: $10 free credits' },
    LAUNCH25: { creditsCents: 2500, maxUses: 1, description: 'Launch promo: $25 free credits' },
    REFERRAL5: { creditsCents: 500, maxUses: 999, description: 'Referral bonus: $5 free credits' },
  };

  const promo = PROMO_CODES[code.toUpperCase()];
  if (!promo) {
    throw new AppError(400, 'INVALID_PROMO', 'Invalid or expired promo code.');
  }

  // TODO: Check if user already used this code (needs promo_redemptions table)
  // For now, apply it directly

  const [user] = await db
    .select({ creditBalanceCents: users.creditBalanceCents })
    .from(users)
    .where(eq(users.id, session.userId));

  const newBalance = (user?.creditBalanceCents || 0) + promo.creditsCents;

  await db
    .update(users)
    .set({
      creditBalanceCents: newBalance,
      updatedAt: new Date(),
    })
    .where(eq(users.id, session.userId));

  logger.info('Promo code redeemed', {
    userId: session.userId,
    code: code.toUpperCase(),
    creditsCents: promo.creditsCents,
    newBalance,
  });

  await cache.invalidateUser(session.userId);

  return c.json({
    success: true,
    data: {
      code: code.toUpperCase(),
      description: promo.description,
      creditsAdded: promo.creditsCents,
      creditsAddedFormatted: `$${(promo.creditsCents / 100).toFixed(2)}`,
      newBalance: newBalance,
      newBalanceFormatted: `$${(newBalance / 100).toFixed(2)}`,
    },
  });
});
