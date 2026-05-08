// ============================================================
// SimpleBuild Pro — Billing Routes (Pay-As-You-Go)
// Daily charges, 50% markup, free tier, spend limits
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '@simplebuildpro/db';
import { users, dailyUsageSummary, billingEvents } from '@simplebuildpro/db';
import { eq, and, sql, gte, desc } from 'drizzle-orm';
import { requireAuth, type AuthEnv } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import {
  createStripeCustomer,
  confirmPaymentMethod,
  getBillingStatus,
  runDailyBilling,
} from '../services/billing';
import { USAGE_COSTS, FREE_TIER_LIMITS, SPENDING_ALERTS } from '@simplebuildpro/shared';

export const billingRoutes = new Hono<AuthEnv>();
billingRoutes.use('*', requireAuth);

// ─── Get Current Usage & Billing Status ──────────────────────
billingRoutes.get('/usage', async (c) => {
  const session = c.get('session');
  const status = await getBillingStatus(session.userId);

  return c.json({
    success: true,
    data: {
      billingStatus: status.status,
      paymentMethodAdded: status.paymentMethodAdded,
      todaySpend: {
        cents: Math.round(status.todaySpendCents * 100) / 100,
        formatted: `$${(status.todaySpendCents / 100).toFixed(2)}`,
      },
      monthSpend: {
        cents: Math.round(status.monthSpendCents * 100) / 100,
        formatted: `$${(status.monthSpendCents / 100).toFixed(2)}`,
      },
      dailyLimit: {
        cents: status.dailyLimit,
        formatted: `$${(status.dailyLimit / 100).toFixed(2)}`,
      },
      creditBalance: {
        cents: status.creditBalance,
        formatted: `$${(status.creditBalance / 100).toFixed(2)}`,
      },
      freeTierLimits: status.paymentMethodAdded ? null : FREE_TIER_LIMITS,
    },
  });
});

// ─── Get Daily Usage History ─────────────────────────────────
billingRoutes.get('/history', async (c) => {
  const session = c.get('session');
  const db = getDb();
  const days = parseInt(c.req.query('days') || '30');

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().split('T')[0];

  const history = await db.query.dailyUsageSummary.findMany({
    where: and(
      eq(dailyUsageSummary.userId, session.userId),
      gte(dailyUsageSummary.date, startDateStr),
    ),
    orderBy: desc(dailyUsageSummary.date),
  });

  return c.json({
    success: true,
    data: history.map((day) => ({
      date: day.date,
      usage: {
        aiMessages: day.aiMessages,
        aiInputTokens: day.aiInputTokens,
        aiOutputTokens: day.aiOutputTokens,
        deploys: day.deploys,
        storageMB: Math.round(day.storageBytes / 1024 / 1024 * 100) / 100,
        previewMinutes: Math.round(day.previewSeconds / 60 * 100) / 100,
        bandwidthMB: Math.round(day.bandwidthBytes / 1024 / 1024 * 100) / 100,
      },
      cost: {
        cents: parseFloat(day.totalPriceCents),
        formatted: `$${(parseFloat(day.totalPriceCents) / 100).toFixed(2)}`,
      },
      charged: day.stripeReported,
    })),
  });
});

// ─── Get Pricing Info ────────────────────────────────────────
billingRoutes.get('/pricing', async (c) => {
  return c.json({
    success: true,
    data: {
      model: 'pay-as-you-go',
      chargeFrequency: 'daily',
      currency: 'usd',
      pricing: {
        ai: {
          inputTokensPer1M: `$${(USAGE_COSTS.ai_input_token.pricePer1M / 100).toFixed(2)}`,
          outputTokensPer1M: `$${(USAGE_COSTS.ai_output_token.pricePer1M / 100).toFixed(2)}`,
          perMessage: `~$${(USAGE_COSTS.ai_message.priceCents / 100).toFixed(4)}`,
        },
        deploy: {
          perDeploy: `$${(USAGE_COSTS.deploy.priceCents / 100).toFixed(4)}`,
        },
        storage: {
          perGBPerDay: `$${(USAGE_COSTS.storage_gb_day.priceCents / 100).toFixed(4)}`,
          perGBPerMonth: `$${(USAGE_COSTS.storage_gb_day.priceCents * 30 / 100).toFixed(2)}`,
        },
        preview: {
          perMinute: `$${(USAGE_COSTS.preview_minute.priceCents / 100).toFixed(4)}`,
        },
        bandwidth: {
          perGB: `$${(USAGE_COSTS.bandwidth_gb.priceCents / 100).toFixed(2)}`,
        },
        customDomain: {
          perMonth: `$${(USAGE_COSTS.custom_domain_day.priceCents * 30 / 100).toFixed(2)}`,
        },
      },
      freeTier: FREE_TIER_LIMITS,
      spendingAlerts: {
        warning: `$${(SPENDING_ALERTS.warning / 100).toFixed(2)}/day`,
        pause: `$${(SPENDING_ALERTS.pause / 100).toFixed(2)}/day`,
        hardLimit: `$${(SPENDING_ALERTS.hardLimit / 100).toFixed(2)}/day`,
      },
    },
  });
});

// ─── Setup Payment Method (Stripe Setup Intent) ──────────────
billingRoutes.post('/setup-payment', async (c) => {
  const session = c.get('session');
  const db = getDb();

  const user = await db.query.users.findFirst({ where: eq(users.id, session.userId) });
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');

  const { customerId, setupIntentClientSecret } = await createStripeCustomer(
    session.userId,
    user.email,
    user.name,
  );

  return c.json({
    success: true,
    data: {
      clientSecret: setupIntentClientSecret,
      customerId,
    },
  });
});

// ─── Confirm Payment Method Added ────────────────────────────
billingRoutes.post('/confirm-payment', async (c) => {
  const session = c.get('session');
  await confirmPaymentMethod(session.userId);

  return c.json({
    success: true,
    data: { message: 'Payment method confirmed. Pay-as-you-go billing is now active.' },
  });
});

// ─── Update Daily Spend Limit ────────────────────────────────
const spendLimitSchema = z.object({
  limitCents: z.number().min(100).max(100000), // $1 to $1000
});

billingRoutes.post('/spend-limit', async (c) => {
  const session = c.get('session');
  const body = await c.req.json();
  const { limitCents } = spendLimitSchema.parse(body);
  const db = getDb();

  await db.update(users).set({
    dailySpendLimitCents: limitCents,
    updatedAt: new Date(),
  }).where(eq(users.id, session.userId));

  // If user was paused due to spend limit, resume
  const user = await db.query.users.findFirst({ where: eq(users.id, session.userId) });
  if (user?.billingStatus === 'paused') {
    await db.update(users).set({ billingStatus: 'active', updatedAt: new Date() })
      .where(eq(users.id, session.userId));
  }

  return c.json({
    success: true,
    data: {
      dailyLimit: limitCents,
      formatted: `$${(limitCents / 100).toFixed(2)}/day`,
    },
  });
});

// ─── Get Billing Events (Charge History) ─────────────────────
billingRoutes.get('/events', async (c) => {
  const session = c.get('session');
  const db = getDb();
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);

  const events = await db.query.billingEvents.findMany({
    where: eq(billingEvents.userId, session.userId),
    orderBy: desc(billingEvents.createdAt),
    limit,
  });

  return c.json({
    success: true,
    data: events.map((e) => ({
      id: e.id,
      type: e.type,
      amount: e.amountCents ? `$${(e.amountCents / 100).toFixed(2)}` : null,
      createdAt: e.createdAt.toISOString(),
    })),
  });
});

// ─── Stripe Webhook (no auth) ────────────────────────────────
// NOTE: This endpoint should be registered WITHOUT requireAuth middleware
// It's handled in the main index.ts separately
export const billingWebhookRoute = new Hono();

billingWebhookRoute.post('/webhook', async (c) => {
  const db = getDb();
  const sig = c.req.header('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // For now, accept events without verification (configure webhook secret later)
  const event = await c.req.json();

  switch (event.type) {
    case 'setup_intent.succeeded': {
      const setupIntent = event.data.object;
      const customerId = setupIntent.customer;
      // Find user by Stripe customer ID and confirm payment method
      const user = await db.query.users.findFirst({
        where: eq(users.stripeCustomerId, customerId),
      });
      if (user) {
        await confirmPaymentMethod(user.id);
      }
      break;
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object;
      const userId = invoice.metadata?.userId;
      if (userId) {
        await db.insert(billingEvents).values({
          userId,
          type: 'charge_succeeded',
          amountCents: invoice.amount_paid,
          stripeEventId: event.id,
          metadata: { invoiceId: invoice.id },
        });
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const userId = invoice.metadata?.userId;
      if (userId) {
        await db.insert(billingEvents).values({
          userId,
          type: 'charge_failed',
          amountCents: invoice.amount_due,
          stripeEventId: event.id,
          metadata: { invoiceId: invoice.id, reason: invoice.last_finalization_error?.message },
        });
        // Suspend after failed payment
        await db.update(users).set({ billingStatus: 'suspended', updatedAt: new Date() })
          .where(eq(users.id, userId));
      }
      break;
    }

    default:
      console.log(`[Billing Webhook] Unhandled: ${event.type}`);
  }

  return c.json({ received: true });
});

// ─── Internal: Trigger Daily Billing (called by Cloud Scheduler) ──
billingRoutes.post('/internal/run-daily-billing', async (c) => {
  // Verify internal auth (in production, use a secret header)
  const internalToken = c.req.header('x-internal-token');
  if (internalToken !== process.env.JWT_SECRET) {
    throw new AppError(403, 'FORBIDDEN', 'Internal endpoint only.');
  }

  const result = await runDailyBilling();

  return c.json({
    success: true,
    data: result,
  });
});
