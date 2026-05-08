// ============================================================
// SimpleBuild Pro — Billing Service
// Pay-As-You-Go: Track costs, report to Stripe daily
// 50% markup over true cost, charged daily
// ============================================================

import Stripe from 'stripe';
import { getDb } from '@simplebuildpro/db';
import { users, usageLogs, dailyUsageSummary, billingEvents } from '@simplebuildpro/db';
import { eq, and, sql, gte, lte } from 'drizzle-orm';
import { USAGE_COSTS, FREE_TIER_LIMITS, SPENDING_ALERTS } from '@simplebuildpro/shared';

let stripeInstance: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripeInstance) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key || key === 'PLACEHOLDER') {
      throw new Error('Stripe not configured');
    }
    stripeInstance = new Stripe(key, { apiVersion: '2024-12-18.acacia' as any });
  }
  return stripeInstance;
}

// ─── Cost Calculation ────────────────────────────────────────

export interface UsageEvent {
  userId: string;
  organizationId?: string;
  type: 'ai_input_tokens' | 'ai_output_tokens' | 'ai_message' | 'deploy' | 'storage' | 'preview_seconds' | 'bandwidth';
  quantity: number;
  metadata?: Record<string, any>;
}

/**
 * Calculate cost and price for a usage event.
 * Cost = what it costs us. Price = what customer pays (cost * 1.5).
 */
export function calculateCost(type: UsageEvent['type'], quantity: number): { costCents: number; priceCents: number } {
  switch (type) {
    case 'ai_input_tokens':
      return {
        costCents: (quantity / 1_000_000) * USAGE_COSTS.ai_input_token.costPer1M,
        priceCents: (quantity / 1_000_000) * USAGE_COSTS.ai_input_token.pricePer1M,
      };
    case 'ai_output_tokens':
      return {
        costCents: (quantity / 1_000_000) * USAGE_COSTS.ai_output_token.costPer1M,
        priceCents: (quantity / 1_000_000) * USAGE_COSTS.ai_output_token.pricePer1M,
      };
    case 'ai_message':
      return {
        costCents: quantity * USAGE_COSTS.ai_message.costCents,
        priceCents: quantity * USAGE_COSTS.ai_message.priceCents,
      };
    case 'deploy':
      return {
        costCents: quantity * USAGE_COSTS.deploy.costCents,
        priceCents: quantity * USAGE_COSTS.deploy.priceCents,
      };
    case 'storage':
      // quantity is in bytes, convert to GB
      const gb = quantity / (1024 * 1024 * 1024);
      return {
        costCents: gb * USAGE_COSTS.storage_gb_day.costCents,
        priceCents: gb * USAGE_COSTS.storage_gb_day.priceCents,
      };
    case 'preview_seconds':
      const minutes = quantity / 60;
      return {
        costCents: minutes * USAGE_COSTS.preview_minute.costCents,
        priceCents: minutes * USAGE_COSTS.preview_minute.priceCents,
      };
    case 'bandwidth':
      // quantity is in bytes, convert to GB
      const bandwidthGb = quantity / (1024 * 1024 * 1024);
      return {
        costCents: bandwidthGb * USAGE_COSTS.bandwidth_gb.costCents,
        priceCents: bandwidthGb * USAGE_COSTS.bandwidth_gb.priceCents,
      };
    default:
      return { costCents: 0, priceCents: 0 };
  }
}

/**
 * Record a usage event with cost calculation.
 * This is the main entry point for all usage tracking.
 */
export async function recordUsage(event: UsageEvent): Promise<{ allowed: boolean; reason?: string }> {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  // Get user billing status
  const user = await db.query.users.findFirst({
    where: eq(users.id, event.userId),
  });

  if (!user) return { allowed: false, reason: 'User not found' };

  // Check if user is suspended
  if (user.billingStatus === 'suspended') {
    return { allowed: false, reason: 'Account suspended. Please add a payment method.' };
  }

  if (user.billingStatus === 'paused') {
    return { allowed: false, reason: 'Account paused due to spending limit. Please increase your limit.' };
  }

  // Check free tier limits (no payment method)
  if (!user.paymentMethodAdded && user.billingStatus === 'free') {
    const allowed = await checkFreeTierLimits(event.userId, event.type, today);
    if (!allowed) {
      return { allowed: false, reason: 'Free tier limit reached. Add a payment method to continue.' };
    }
  }

  // Calculate cost
  const { costCents, priceCents } = calculateCost(event.type, event.quantity);

  // Check daily spend limit
  if (user.paymentMethodAdded && user.dailySpendLimitCents) {
    const todaySpend = await getDailySpend(event.userId, today);
    const newTotal = todaySpend + priceCents;

    if (newTotal >= (user.dailySpendLimitCents || SPENDING_ALERTS.hardLimit)) {
      // Hard stop
      await db.update(users).set({ billingStatus: 'paused', updatedAt: new Date() }).where(eq(users.id, event.userId));
      await db.insert(billingEvents).values({
        userId: event.userId,
        type: 'spend_limit_reached',
        amountCents: Math.round(newTotal),
        metadata: { limit: user.dailySpendLimitCents, today },
      });
      return { allowed: false, reason: 'Daily spend limit reached.' };
    }
  }

  // Record the usage
  await db.insert(usageLogs).values({
    userId: event.userId,
    organizationId: event.organizationId || null,
    type: event.type,
    quantity: event.quantity,
    costCents: costCents.toFixed(4),
    priceCents: priceCents.toFixed(4),
    billed: false,
    billingPeriod: today,
    metadata: event.metadata || {},
  });

  // Update daily summary (upsert)
  await updateDailySummary(event.userId, today, event.type, event.quantity, costCents, priceCents);

  return { allowed: true };
}

/**
 * Check free tier limits for today.
 */
async function checkFreeTierLimits(userId: string, type: string, today: string): Promise<boolean> {
  const db = getDb();

  const todaySummary = await db.query.dailyUsageSummary.findFirst({
    where: and(eq(dailyUsageSummary.userId, userId), eq(dailyUsageSummary.date, today)),
  });

  if (!todaySummary) return true; // No usage today

  switch (type) {
    case 'ai_input_tokens':
    case 'ai_output_tokens':
    case 'ai_message':
      return todaySummary.aiMessages < FREE_TIER_LIMITS.ai_messages;
    case 'deploy':
      return todaySummary.deploys < FREE_TIER_LIMITS.deploys;
    case 'preview_seconds':
      return todaySummary.previewSeconds < (FREE_TIER_LIMITS.preview_minutes * 60);
    case 'bandwidth':
      return todaySummary.bandwidthBytes < (FREE_TIER_LIMITS.bandwidth_mb * 1024 * 1024);
    default:
      return true;
  }
}

/**
 * Get total spend for a user today.
 */
async function getDailySpend(userId: string, today: string): Promise<number> {
  const db = getDb();
  const summary = await db.query.dailyUsageSummary.findFirst({
    where: and(eq(dailyUsageSummary.userId, userId), eq(dailyUsageSummary.date, today)),
  });
  return parseFloat(summary?.totalPriceCents || '0');
}

/**
 * Upsert daily usage summary.
 */
async function updateDailySummary(
  userId: string,
  date: string,
  type: string,
  quantity: number,
  costCents: number,
  priceCents: number
): Promise<void> {
  const db = getDb();

  // Check if summary exists for today
  const existing = await db.query.dailyUsageSummary.findFirst({
    where: and(eq(dailyUsageSummary.userId, userId), eq(dailyUsageSummary.date, date)),
  });

  if (!existing) {
    // Create new summary
    const values: any = {
      userId,
      date,
      aiInputTokens: 0,
      aiOutputTokens: 0,
      aiMessages: 0,
      deploys: 0,
      storageBytes: 0,
      previewSeconds: 0,
      bandwidthBytes: 0,
      totalCostCents: costCents.toFixed(4),
      totalPriceCents: priceCents.toFixed(4),
    };

    switch (type) {
      case 'ai_input_tokens': values.aiInputTokens = quantity; values.aiMessages = 1; break;
      case 'ai_output_tokens': values.aiOutputTokens = quantity; break;
      case 'ai_message': values.aiMessages = quantity; break;
      case 'deploy': values.deploys = quantity; break;
      case 'storage': values.storageBytes = quantity; break;
      case 'preview_seconds': values.previewSeconds = quantity; break;
      case 'bandwidth': values.bandwidthBytes = quantity; break;
    }

    await db.insert(dailyUsageSummary).values(values);
  } else {
    // Update existing summary
    const updates: any = {
      totalCostCents: (parseFloat(existing.totalCostCents) + costCents).toFixed(4),
      totalPriceCents: (parseFloat(existing.totalPriceCents) + priceCents).toFixed(4),
      updatedAt: new Date(),
    };

    switch (type) {
      case 'ai_input_tokens':
        updates.aiInputTokens = existing.aiInputTokens + quantity;
        updates.aiMessages = existing.aiMessages + 1;
        break;
      case 'ai_output_tokens':
        updates.aiOutputTokens = existing.aiOutputTokens + quantity;
        break;
      case 'ai_message':
        updates.aiMessages = existing.aiMessages + quantity;
        break;
      case 'deploy':
        updates.deploys = existing.deploys + quantity;
        break;
      case 'storage':
        updates.storageBytes = existing.storageBytes + quantity;
        break;
      case 'preview_seconds':
        updates.previewSeconds = existing.previewSeconds + quantity;
        break;
      case 'bandwidth':
        updates.bandwidthBytes = existing.bandwidthBytes + quantity;
        break;
    }

    await db.update(dailyUsageSummary).set(updates).where(eq(dailyUsageSummary.id, existing.id));
  }
}

// ─── Stripe Integration ──────────────────────────────────────

/**
 * Create a Stripe customer and setup intent for payment method collection.
 */
export async function createStripeCustomer(userId: string, email: string, name: string): Promise<{
  customerId: string;
  setupIntentClientSecret: string;
}> {
  const stripe = getStripe();
  const db = getDb();

  // Check if user already has a Stripe customer
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (user?.stripeCustomerId) {
    // Create new setup intent for existing customer
    const setupIntent = await stripe.setupIntents.create({
      customer: user.stripeCustomerId,
      payment_method_types: ['card'],
    });
    return { customerId: user.stripeCustomerId, setupIntentClientSecret: setupIntent.client_secret! };
  }

  // Create new Stripe customer
  const customer = await stripe.customers.create({
    email,
    name,
    metadata: { userId, platform: 'simplebuildpro' },
  });

  // Update user with Stripe customer ID
  await db.update(users).set({
    stripeCustomerId: customer.id,
    updatedAt: new Date(),
  }).where(eq(users.id, userId));

  // Create Setup Intent for card collection
  const setupIntent = await stripe.setupIntents.create({
    customer: customer.id,
    payment_method_types: ['card'],
  });

  return { customerId: customer.id, setupIntentClientSecret: setupIntent.client_secret! };
}

/**
 * Confirm payment method was added (called after Stripe Setup Intent succeeds).
 */
export async function confirmPaymentMethod(userId: string): Promise<void> {
  const db = getDb();
  await db.update(users).set({
    paymentMethodAdded: true,
    billingStatus: 'active',
    updatedAt: new Date(),
  }).where(eq(users.id, userId));

  await db.insert(billingEvents).values({
    userId,
    type: 'payment_method_added',
    metadata: { timestamp: new Date().toISOString() },
  });
}

/**
 * Daily billing job: aggregate usage and charge via Stripe.
 * This should be called by Cloud Scheduler once daily (e.g. 00:05 UTC).
 */
export async function runDailyBilling(targetDate?: string): Promise<{
  processed: number;
  charged: number;
  totalRevenue: number;
  errors: string[];
}> {
  const db = getDb();
  const stripe = getStripe();
  const date = targetDate || new Date(Date.now() - 86400000).toISOString().split('T')[0]; // Yesterday

  const errors: string[] = [];
  let processed = 0;
  let charged = 0;
  let totalRevenue = 0;

  // Get all unreported daily summaries for the target date
  const summaries = await db.query.dailyUsageSummary.findMany({
    where: and(
      eq(dailyUsageSummary.date, date),
      eq(dailyUsageSummary.stripeReported, false),
    ),
  });

  for (const summary of summaries) {
    processed++;
    const priceCents = parseFloat(summary.totalPriceCents);

    if (priceCents <= 0) {
      // No charges, just mark as reported
      await db.update(dailyUsageSummary).set({ stripeReported: true, updatedAt: new Date() })
        .where(eq(dailyUsageSummary.id, summary.id));
      continue;
    }

    // Get user's Stripe customer ID
    const user = await db.query.users.findFirst({ where: eq(users.id, summary.userId) });
    if (!user?.stripeCustomerId || !user.paymentMethodAdded) {
      // Free user with no card — skip charging but mark as reported
      await db.update(dailyUsageSummary).set({ stripeReported: true, updatedAt: new Date() })
        .where(eq(dailyUsageSummary.id, summary.id));
      continue;
    }

    try {
      // Create an invoice item for this day's usage
      const invoiceItem = await stripe.invoiceItems.create({
        customer: user.stripeCustomerId,
        amount: Math.round(priceCents), // Stripe uses integer cents
        currency: 'usd',
        description: `SimpleBuild Pro usage for ${date} (AI: ${summary.aiMessages} msgs, Deploys: ${summary.deploys}, Storage: ${(summary.storageBytes / 1024 / 1024).toFixed(1)}MB)`,
        metadata: {
          userId: summary.userId,
          date,
          aiMessages: String(summary.aiMessages),
          aiInputTokens: String(summary.aiInputTokens),
          aiOutputTokens: String(summary.aiOutputTokens),
          deploys: String(summary.deploys),
        },
      });

      // Create and pay invoice immediately (daily charge)
      const invoice = await stripe.invoices.create({
        customer: user.stripeCustomerId,
        auto_advance: true, // Auto-finalize
        collection_method: 'charge_automatically',
        metadata: { date, userId: summary.userId },
      });

      await stripe.invoices.finalizeInvoice(invoice.id);
      await stripe.invoices.pay(invoice.id);

      // Mark as reported
      await db.update(dailyUsageSummary).set({
        stripeReported: true,
        stripeInvoiceItemId: invoiceItem.id,
        updatedAt: new Date(),
      }).where(eq(dailyUsageSummary.id, summary.id));

      // Log billing event
      await db.insert(billingEvents).values({
        userId: summary.userId,
        type: 'charge_succeeded',
        amountCents: Math.round(priceCents),
        stripeEventId: invoice.id,
        metadata: { date, invoiceId: invoice.id },
      });

      charged++;
      totalRevenue += priceCents;
    } catch (err: any) {
      errors.push(`User ${summary.userId}: ${err.message}`);

      // Log failed charge
      await db.insert(billingEvents).values({
        userId: summary.userId,
        type: 'charge_failed',
        amountCents: Math.round(priceCents),
        metadata: { date, error: err.message },
      });

      // If payment fails, suspend account after 3 failures
      // (simplified — in production, implement retry logic)
    }
  }

  // Mark all usage_logs for this date as billed
  await db.update(usageLogs).set({ billed: true })
    .where(and(eq(usageLogs.billingPeriod, date), eq(usageLogs.billed, false)));

  return { processed, charged, totalRevenue, errors };
}

/**
 * Get current billing status and spend for a user.
 */
export async function getBillingStatus(userId: string): Promise<{
  status: string;
  todaySpendCents: number;
  monthSpendCents: number;
  dailyLimit: number;
  paymentMethodAdded: boolean;
  creditBalance: number;
}> {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];
  const monthStart = today.substring(0, 7) + '-01'; // YYYY-MM-01

  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new Error('User not found');

  // Today's spend
  const todaySummary = await db.query.dailyUsageSummary.findFirst({
    where: and(eq(dailyUsageSummary.userId, userId), eq(dailyUsageSummary.date, today)),
  });

  // Month spend (sum of all daily summaries this month)
  const monthSpend = await db.select({
    total: sql<string>`COALESCE(SUM(CAST(${dailyUsageSummary.totalPriceCents} AS NUMERIC)), 0)`,
  })
    .from(dailyUsageSummary)
    .where(and(
      eq(dailyUsageSummary.userId, userId),
      gte(dailyUsageSummary.date, monthStart),
    ));

  return {
    status: user.billingStatus,
    todaySpendCents: parseFloat(todaySummary?.totalPriceCents || '0'),
    monthSpendCents: parseFloat(monthSpend[0]?.total || '0'),
    dailyLimit: user.dailySpendLimitCents || SPENDING_ALERTS.hardLimit,
    paymentMethodAdded: user.paymentMethodAdded,
    creditBalance: user.creditBalanceCents,
  };
}
