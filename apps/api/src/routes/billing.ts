// ============================================================
// SimpleBuild Pro — Billing Routes
// Real Stripe integration for subscription management
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import Stripe from 'stripe';
import { getDb } from '@simplebuildpro/db';
import { users, subscriptions, usageLogs } from '@simplebuildpro/db';
import { eq, and, sql, gte, count, sum } from 'drizzle-orm';
import { requireAuth, type AuthEnv } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import { PLAN_LIMITS, STRIPE_PRICE_IDS } from '@simplebuildpro/shared';

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new AppError(500, 'STRIPE_NOT_CONFIGURED', 'Stripe is not configured.');
  return new Stripe(key, { apiVersion: '2024-12-18.acacia' as any });
}

export const billingRoutes = new Hono<AuthEnv>();
billingRoutes.use('*', requireAuth);

// ─── Get Usage Metrics ───────────────────────────────────────
billingRoutes.get('/usage', async (c) => {
  const session = c.get('session');
  const db = getDb();

  const limits = PLAN_LIMITS[session.plan];

  // Get usage for current billing period (month)
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const aiUsage = await db.select({ total: sql<number>`COALESCE(SUM(${usageLogs.quantity}), 0)` })
    .from(usageLogs)
    .where(and(
      eq(usageLogs.userId, session.userId),
      eq(usageLogs.type, 'ai_tokens'),
      gte(usageLogs.createdAt, monthStart),
    ));

  const deployUsage = await db.select({ total: sql<number>`COALESCE(COUNT(*), 0)` })
    .from(usageLogs)
    .where(and(
      eq(usageLogs.userId, session.userId),
      eq(usageLogs.type, 'deploy'),
      gte(usageLogs.createdAt, monthStart),
    ));

  const storageUsage = await db.select({ total: sql<number>`COALESCE(SUM(${usageLogs.quantity}), 0)` })
    .from(usageLogs)
    .where(and(
      eq(usageLogs.userId, session.userId),
      eq(usageLogs.type, 'storage'),
    ));

  // Project count
  const { projects } = await import('@simplebuildpro/db');
  const [{ count: projectsCount }] = await db.select({ count: count() })
    .from(projects)
    .where(eq(projects.ownerId, session.userId));

  return c.json({
    success: true,
    data: {
      plan: session.plan,
      aiTokensUsed: Number(aiUsage[0]?.total || 0),
      aiTokensLimit: limits.aiMessagesPerMonth,
      deploysUsed: Number(deployUsage[0]?.total || 0),
      deploysLimit: limits.deploysPerMonth,
      storageUsedBytes: Number(storageUsage[0]?.total || 0),
      storageLimitBytes: limits.storageBytes,
      projectsCount: Number(projectsCount),
      projectsLimit: limits.projects,
      customDomainsLimit: limits.customDomains,
    },
  });
});

// ─── Create Checkout Session ─────────────────────────────────
const checkoutSchema = z.object({
  plan: z.enum(['pro', 'business']),
  interval: z.enum(['monthly', 'yearly']),
});

billingRoutes.post('/checkout', async (c) => {
  const session = c.get('session');
  const body = await c.req.json();
  const { plan, interval } = checkoutSchema.parse(body);

  const stripe = getStripe();
  const db = getDb();

  // Get or create Stripe customer
  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
  });
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');

  // Check existing subscription
  const existingSub = await db.query.subscriptions.findFirst({
    where: and(eq(subscriptions.userId, session.userId), eq(subscriptions.status, 'active')),
  });

  let customerId: string;
  if (existingSub) {
    customerId = existingSub.stripeCustomerId;
  } else {
    // Create new Stripe customer
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.name,
      metadata: { userId: user.id },
    });
    customerId = customer.id;
  }

  const priceKey = `${plan}_${interval}` as keyof typeof STRIPE_PRICE_IDS;
  const priceId = STRIPE_PRICE_IDS[priceKey];

  if (!priceId) {
    throw new AppError(400, 'INVALID_PLAN', `Invalid plan: ${plan} ${interval}`);
  }

  // Create Stripe checkout session
  const checkoutSession = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `https://simplebuildpro.com/dashboard/settings?billing=success`,
    cancel_url: `https://simplebuildpro.com/dashboard/settings?billing=canceled`,
    metadata: {
      userId: session.userId,
      plan,
      interval,
    },
  });

  return c.json({
    success: true,
    data: {
      checkoutUrl: checkoutSession.url,
      sessionId: checkoutSession.id,
    },
  });
});

// ─── Customer Portal ─────────────────────────────────────────
billingRoutes.post('/portal', async (c) => {
  const session = c.get('session');
  const stripe = getStripe();
  const db = getDb();

  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, session.userId),
  });

  if (!sub) {
    throw new AppError(404, 'NO_SUBSCRIPTION', 'No active subscription found.');
  }

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: 'https://simplebuildpro.com/dashboard/settings',
  });

  return c.json({
    success: true,
    data: { portalUrl: portalSession.url },
  });
});

// ─── Get Subscription ────────────────────────────────────────
billingRoutes.get('/subscription', async (c) => {
  const session = c.get('session');
  const db = getDb();

  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, session.userId),
  });

  if (!sub) {
    return c.json({
      success: true,
      data: { plan: 'free', subscription: null },
    });
  }

  return c.json({
    success: true,
    data: {
      plan: sub.plan,
      subscription: {
        id: sub.id,
        status: sub.status,
        currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
      },
    },
  });
});

// ─── Stripe Webhook ──────────────────────────────────────────
// This should be registered at /api/v1/billing/webhook WITHOUT auth middleware
// For production, verify webhook signature with STRIPE_WEBHOOK_SECRET
billingRoutes.post('/webhook', async (c) => {
  const stripe = getStripe();
  const db = getDb();

  const sig = c.req.header('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event: Stripe.Event;

  if (webhookSecret && sig) {
    const rawBody = await c.req.text();
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (err) {
      console.error('[Stripe] Webhook signature verification failed:', err);
      return c.json({ error: 'Webhook signature verification failed' }, 400);
    }
  } else {
    // Development mode — no signature verification
    event = await c.req.json() as Stripe.Event;
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const checkoutSession = event.data.object as Stripe.Checkout.Session;
      const userId = checkoutSession.metadata?.userId;
      const plan = checkoutSession.metadata?.plan;

      if (userId && plan && checkoutSession.subscription) {
        const stripeSubscription = await stripe.subscriptions.retrieve(
          checkoutSession.subscription as string
        );

        await db.insert(subscriptions).values({
          userId,
          stripeCustomerId: checkoutSession.customer as string,
          stripeSubscriptionId: stripeSubscription.id,
          plan: plan as any,
          status: 'active',
          currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
        });

        // Update user plan
        await db.update(users)
          .set({ plan: plan as any, updatedAt: new Date() })
          .where(eq(users.id, userId));

        console.log(`[Stripe] User ${userId} upgraded to ${plan}`);
      }
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      await db.update(subscriptions)
        .set({
          status: sub.status === 'active' ? 'active' : sub.status === 'past_due' ? 'past_due' : 'canceled',
          currentPeriodEnd: new Date(sub.current_period_end * 1000),
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.stripeSubscriptionId, sub.id));
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;

      // Downgrade to free
      const existingSub = await db.query.subscriptions.findFirst({
        where: eq(subscriptions.stripeSubscriptionId, sub.id),
      });

      if (existingSub?.userId) {
        await db.update(users)
          .set({ plan: 'free', updatedAt: new Date() })
          .where(eq(users.id, existingSub.userId));
      }

      await db.update(subscriptions)
        .set({ status: 'canceled', updatedAt: new Date() })
        .where(eq(subscriptions.stripeSubscriptionId, sub.id));

      console.log(`[Stripe] Subscription ${sub.id} canceled`);
      break;
    }

    default:
      console.log(`[Stripe] Unhandled event: ${event.type}`);
  }

  return c.json({ received: true });
});
