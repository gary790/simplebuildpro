// ============================================================
// SimpleBuild Pro — Dedicated Infrastructure API Routes
// Manages enterprise dedicated environments via API
// Phase 5.2a: Scale & Enterprise
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '@simplebuildpro/db';
import { organizations, orgMembers } from '@simplebuildpro/db';
import { eq, and, sql } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth';
import type { AuthEnv } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import { auditLog, getAuditContext } from '../services/audit';
import { logger } from '../services/logger';

export const dedicatedRoutes = new Hono<AuthEnv>();
dedicatedRoutes.use('*', requireAuth);

// ─── Get Dedicated Environment Status ───────────────────────────────────────
dedicatedRoutes.get('/status/:orgId', async (c) => {
  const session = c.get('session');
  const orgId = c.req.param('orgId');
  const db = getDb();

  // Verify org owner/admin
  const membership = await db.query.orgMembers.findFirst({
    where: and(eq(orgMembers.organizationId, orgId), eq(orgMembers.userId, session.userId)),
  });

  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    throw new AppError(403, 'FORBIDDEN', 'Only org owners/admins can view dedicated infrastructure.');
  }

  // Check org plan
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });

  if (!org) {
    throw new AppError(404, 'ORG_NOT_FOUND', 'Organization not found.');
  }

  if (org.plan !== 'enterprise') {
    return c.json({
      success: true,
      data: {
        eligible: false,
        currentPlan: org.plan,
        message: 'Dedicated infrastructure requires an Enterprise plan.',
        upgradeUrl: '/dashboard/settings/billing?upgrade=enterprise',
      },
    });
  }

  // Check if dedicated environment exists
  const [dedicated] = (await db.execute(sql`
    SELECT * FROM dedicated_environments WHERE organization_id = ${orgId}
  `)) as any[];

  if (!dedicated) {
    return c.json({
      success: true,
      data: {
        eligible: true,
        provisioned: false,
        tiers: [
          {
            name: 'standard',
            displayName: 'Standard Dedicated',
            description: 'Isolated Cloud Run service, dedicated DB schema, private GCS bucket',
            price: '$499/mo',
            features: [
              'Isolated compute (no noisy neighbors)',
              'Dedicated database schema',
              'Private GCS bucket',
              'Custom subdomain (orgslug.enterprise.simplebuildpro.com)',
              'Min 1 instance (no cold starts)',
              'Max 5 instances auto-scale',
              '99.9% SLA',
            ],
          },
          {
            name: 'premium',
            displayName: 'Premium Dedicated',
            description: 'Fully isolated: own DB instance, Redis instance, enhanced resources',
            price: '$1,499/mo',
            features: [
              'Everything in Standard, plus:',
              'Dedicated Cloud SQL instance (private IP)',
              'Dedicated Redis instance (1GB)',
              'Enhanced resources: 1Gi RAM, 2 vCPU',
              'Min 2 instances (high availability)',
              'Max 10 instances auto-scale',
              'Daily automated DB backups + PITR',
              '99.95% SLA',
              'Priority support (4h response time)',
            ],
          },
        ],
      },
    });
  }

  return c.json({
    success: true,
    data: {
      eligible: true,
      provisioned: true,
      environment: {
        tier: dedicated.tier,
        region: dedicated.region,
        serviceUrl: dedicated.service_url,
        customDomain: dedicated.custom_domain,
        status: dedicated.status,
        provisionedAt: dedicated.provisioned_at,
        resources: {
          cloudRunService: dedicated.cloud_run_service,
          gcsBucket: dedicated.gcs_bucket,
          databaseInstance: dedicated.database_instance,
          redisInstance: dedicated.redis_instance,
        },
        health: {
          lastHealthCheck: dedicated.last_health_check,
          healthStatus: dedicated.health_status,
        },
      },
    },
  });
});

// ─── Request Dedicated Environment Provisioning ─────────────────────────────
const provisionSchema = z.object({
  tier: z.enum(['standard', 'premium']),
  region: z.enum(['us-central1', 'us-east1', 'europe-west1', 'europe-west4', 'asia-east1']).default('us-central1'),
  customDomain: z.string().max(253).optional(),
});

dedicatedRoutes.post('/provision/:orgId', async (c) => {
  const session = c.get('session');
  const orgId = c.req.param('orgId');
  const body = await c.req.json();
  const { tier, region, customDomain } = provisionSchema.parse(body);
  const db = getDb();

  // Verify org owner
  const membership = await db.query.orgMembers.findFirst({
    where: and(eq(orgMembers.organizationId, orgId), eq(orgMembers.userId, session.userId)),
  });

  if (!membership || membership.role !== 'owner') {
    throw new AppError(403, 'FORBIDDEN', 'Only org owners can provision dedicated infrastructure.');
  }

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });

  if (!org || org.plan !== 'enterprise') {
    throw new AppError(403, 'PLAN_REQUIRED', 'Dedicated infrastructure requires an Enterprise plan.');
  }

  // Check if already provisioned
  const [existing] = (await db.execute(sql`
    SELECT id FROM dedicated_environments WHERE organization_id = ${orgId}
  `)) as any[];

  if (existing) {
    throw new AppError(409, 'ALREADY_PROVISIONED', 'This organization already has a dedicated environment.');
  }

  // Create provisioning record (async — actual provisioning happens via background job)
  await db.execute(sql`
    INSERT INTO dedicated_environments (
      id, organization_id, tier, region, status, custom_domain,
      cloud_run_service, gcs_bucket, provisioned_at, created_at
    ) VALUES (
      gen_random_uuid(), ${orgId}, ${tier}, ${region}, 'provisioning',
      ${customDomain || null},
      ${'sbpro-ent-' + org.slug}, ${'simplebuildpro-ent-' + org.slug},
      NOW(), NOW()
    )
  `);

  const ctx = getAuditContext(c);
  auditLog.log({
    ...ctx,
    action: 'org.update',
    resourceType: 'organization',
    resourceId: orgId,
    metadata: { type: 'dedicated_provision_requested', tier, region },
    severity: 'warning',
  });

  logger.info('Dedicated environment provisioning requested', {
    orgId,
    orgSlug: org.slug,
    tier,
    region,
  });

  return c.json({
    success: true,
    data: {
      message: `Dedicated ${tier} environment provisioning initiated. ETA: ${tier === 'premium' ? '15-30 minutes' : '5-10 minutes'}.`,
      status: 'provisioning',
      tier,
      region,
      estimatedReadyAt: new Date(Date.now() + (tier === 'premium' ? 30 * 60000 : 10 * 60000)).toISOString(),
    },
  }, 202);
});

// ─── Scale Dedicated Environment ────────────────────────────────────────────
const scaleSchema = z.object({
  minInstances: z.number().min(0).max(10).optional(),
  maxInstances: z.number().min(1).max(50).optional(),
  memory: z.enum(['512Mi', '1Gi', '2Gi', '4Gi']).optional(),
  cpu: z.enum(['1', '2', '4']).optional(),
});

dedicatedRoutes.patch('/scale/:orgId', async (c) => {
  const session = c.get('session');
  const orgId = c.req.param('orgId');
  const body = await c.req.json();
  const scaling = scaleSchema.parse(body);
  const db = getDb();

  // Verify org owner
  const membership = await db.query.orgMembers.findFirst({
    where: and(eq(orgMembers.organizationId, orgId), eq(orgMembers.userId, session.userId)),
  });

  if (!membership || membership.role !== 'owner') {
    throw new AppError(403, 'FORBIDDEN', 'Only org owners can scale dedicated infrastructure.');
  }

  const [dedicated] = (await db.execute(sql`
    SELECT * FROM dedicated_environments WHERE organization_id = ${orgId}
  `)) as any[];

  if (!dedicated) {
    throw new AppError(404, 'NOT_PROVISIONED', 'No dedicated environment found for this organization.');
  }

  if (dedicated.status !== 'active') {
    throw new AppError(400, 'NOT_ACTIVE', `Cannot scale environment in "${dedicated.status}" state.`);
  }

  // Update scaling config in database (actual Cloud Run update via background job)
  await db.execute(sql`
    UPDATE dedicated_environments
    SET scaling_config = ${JSON.stringify(scaling)}::jsonb,
        status = 'scaling',
        updated_at = NOW()
    WHERE organization_id = ${orgId}
  `);

  auditLog.log({
    ...getAuditContext(c),
    action: 'org.update',
    resourceType: 'organization',
    resourceId: orgId,
    metadata: { type: 'dedicated_scale', ...scaling },
  });

  return c.json({
    success: true,
    data: {
      message: 'Scaling update queued. Changes will apply within 2-5 minutes.',
      scaling,
    },
  });
});

// ─── Deprovision Dedicated Environment ──────────────────────────────────────
const deprovisionSchema = z.object({
  confirmation: z.literal('DEPROVISION'),
  reason: z.string().max(500).optional(),
});

dedicatedRoutes.delete('/deprovision/:orgId', async (c) => {
  const session = c.get('session');
  const orgId = c.req.param('orgId');
  const body = await c.req.json();
  const { confirmation, reason } = deprovisionSchema.parse(body);
  const db = getDb();

  if (confirmation !== 'DEPROVISION') {
    throw new AppError(400, 'CONFIRMATION_REQUIRED', 'Type "DEPROVISION" to confirm.');
  }

  const membership = await db.query.orgMembers.findFirst({
    where: and(eq(orgMembers.organizationId, orgId), eq(orgMembers.userId, session.userId)),
  });

  if (!membership || membership.role !== 'owner') {
    throw new AppError(403, 'FORBIDDEN', 'Only org owners can deprovision dedicated infrastructure.');
  }

  const [dedicated] = (await db.execute(sql`
    SELECT * FROM dedicated_environments WHERE organization_id = ${orgId}
  `)) as any[];

  if (!dedicated) {
    throw new AppError(404, 'NOT_PROVISIONED', 'No dedicated environment found.');
  }

  // Mark for teardown (actual deletion via background job)
  await db.execute(sql`
    UPDATE dedicated_environments
    SET status = 'deprovisioning', updated_at = NOW()
    WHERE organization_id = ${orgId}
  `);

  await auditLog.logSync({
    ...getAuditContext(c),
    action: 'org.update',
    resourceType: 'organization',
    resourceId: orgId,
    metadata: { type: 'dedicated_deprovision', reason: reason || 'owner_requested', tier: dedicated.tier },
    severity: 'critical',
  });

  return c.json({
    success: true,
    data: {
      message: 'Deprovisioning initiated. All dedicated resources will be removed within 30 minutes.',
      warning: 'This action is irreversible. All data in the dedicated environment will be permanently deleted.',
    },
  });
});
