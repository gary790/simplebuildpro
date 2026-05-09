// ============================================================
// SimpleBuild Pro — Data Residency Routes
// API endpoints for managing organization data residency settings
// ============================================================

import { Hono } from 'hono';
import { getDb } from '@simplebuildpro/db';
import { organizations, orgMembers } from '@simplebuildpro/db';
import { eq, and, sql } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth';
import type { AuthEnv } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import { auditLog, getAuditContext } from '../services/audit';
import { logger } from '../services/logger';
import { 
  type DataRegion, 
  REGION_CONFIGS, 
  isTransferAllowed 
} from '../middleware/data-residency';

const app = new Hono<AuthEnv>();

// All routes require authentication
app.use('*', requireAuth);

// ─── GET /api/v1/data-residency/:orgId ───────────────────────
// Get current data residency settings for an organization
app.get('/:orgId', async (c) => {
  const orgId = c.req.param('orgId');
  const session = c.get('session');
  const db = getDb();

  // Verify org membership
  const membership = await db.query.orgMembers.findFirst({
    where: and(eq(orgMembers.organizationId, orgId), eq(orgMembers.userId, session.userId)),
  });
  if (!membership) {
    throw new AppError(403, 'FORBIDDEN', 'Not a member of this organization');
  }

  // Get org residency settings
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });

  if (!org) {
    throw new AppError(404, 'ORG_NOT_FOUND', 'Organization not found');
  }

  // Query extended residency fields via raw SQL (columns may not be in Drizzle schema yet)
  const [residencyData] = (await db.execute(sql`
    SELECT data_region, enforce_strict_residency, allowed_regions
    FROM organizations WHERE id = ${orgId}
  `)) as any[];

  const dataRegion = residencyData?.data_region || 'us';
  const enforceStrict = residencyData?.enforce_strict_residency || false;
  const allowedRegions = residencyData?.allowed_regions || ['us', 'eu'];

  return c.json({
    success: true,
    data: {
      organizationId: org.id,
      organizationName: org.name,
      currentRegion: dataRegion,
      enforceStrict,
      allowedRegions,
      plan: org.plan,
      regionDetails: REGION_CONFIGS[dataRegion as DataRegion] || REGION_CONFIGS['us'],
      availableRegions: Object.entries(REGION_CONFIGS).map(([key, config]) => ({
        id: key,
        ...config,
      })),
      compliance: {
        gdprCompliant: true,
        euUsDataPrivacyFramework: true,
        standardContractualClauses: true,
      },
    },
  });
});

// ─── PUT /api/v1/data-residency/:orgId ───────────────────────
// Update data residency settings (Enterprise only)
app.put('/:orgId', async (c) => {
  const orgId = c.req.param('orgId');
  const session = c.get('session');
  const body = await c.req.json<{
    region: DataRegion;
    enforceStrict?: boolean;
    allowedRegions?: DataRegion[];
  }>();
  const db = getDb();

  // Verify org ownership/admin
  const membership = await db.query.orgMembers.findFirst({
    where: and(eq(orgMembers.organizationId, orgId), eq(orgMembers.userId, session.userId)),
  });
  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    throw new AppError(403, 'FORBIDDEN', 'Only org owners/admins can change data residency');
  }

  // Check plan — data residency requires enterprise
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });
  if (!org) {
    throw new AppError(404, 'ORG_NOT_FOUND', 'Organization not found');
  }
  if (org.plan !== 'enterprise') {
    throw new AppError(403, 'PLAN_REQUIRED', 'Data residency options require Enterprise plan');
  }

  // Validate region
  const { region, enforceStrict = false, allowedRegions = ['us', 'eu'] } = body;
  if (!region || !REGION_CONFIGS[region]) {
    throw new AppError(400, 'INVALID_REGION', `Invalid region. Available: ${Object.keys(REGION_CONFIGS).join(', ')}`);
  }

  // Validate allowed regions
  for (const r of allowedRegions) {
    if (!REGION_CONFIGS[r]) {
      throw new AppError(400, 'INVALID_REGION', `Invalid allowed region: ${r}`);
    }
  }

  // Get current region for comparison
  const [currentData] = (await db.execute(sql`
    SELECT data_region FROM organizations WHERE id = ${orgId}
  `)) as any[];
  const currentRegion = currentData?.data_region || 'us';
  const needsMigration = currentRegion !== region;

  // Update residency settings
  await db.execute(sql`
    UPDATE organizations 
    SET data_region = ${region}, 
        enforce_strict_residency = ${enforceStrict}, 
        allowed_regions = ${JSON.stringify(allowedRegions)},
        updated_at = NOW()
    WHERE id = ${orgId}
  `);

  // Audit log
  await auditLog.log({
    ...getAuditContext(c),
    action: 'org.data_residency_changed',
    resourceType: 'organization',
    resourceId: orgId,
    severity: 'high',
    metadata: {
      previousRegion: currentRegion,
      newRegion: region,
      enforceStrict,
      allowedRegions,
      needsMigration,
    },
  });

  logger.info('Data residency updated', { orgId, region, previousRegion: currentRegion });

  return c.json({
    success: true,
    data: {
      region,
      enforceStrict,
      allowedRegions,
      regionDetails: REGION_CONFIGS[region],
      migrationRequired: needsMigration,
      migrationNote: needsMigration
        ? `Data migration from ${currentRegion} to ${region} will be scheduled. This process may take 24-72 hours depending on data volume.`
        : undefined,
    },
  });
});

// ─── POST /api/v1/data-residency/:orgId/validate-transfer ────
// Check if a data transfer between regions is allowed
app.post('/:orgId/validate-transfer', async (c) => {
  const orgId = c.req.param('orgId');
  const session = c.get('session');
  const body = await c.req.json<{
    sourceRegion: DataRegion;
    targetRegion: DataRegion;
  }>();
  const db = getDb();

  // Verify org membership
  const membership = await db.query.orgMembers.findFirst({
    where: and(eq(orgMembers.organizationId, orgId), eq(orgMembers.userId, session.userId)),
  });
  if (!membership) {
    throw new AppError(403, 'FORBIDDEN', 'Not a member of this organization');
  }

  // Get org settings
  const [residencyData] = (await db.execute(sql`
    SELECT data_region, enforce_strict_residency, allowed_regions
    FROM organizations WHERE id = ${orgId}
  `)) as any[];

  const orgSettings = residencyData ? {
    region: (residencyData.data_region || 'us') as DataRegion,
    enforceStrict: residencyData.enforce_strict_residency || false,
    allowedRegions: residencyData.allowed_regions || ['us', 'eu'],
    createdAt: '',
    updatedAt: '',
  } : undefined;

  const result = isTransferAllowed(body.sourceRegion, body.targetRegion, orgSettings);

  return c.json({
    success: true,
    data: {
      ...result,
      sourceRegion: body.sourceRegion,
      targetRegion: body.targetRegion,
      sourceDetails: REGION_CONFIGS[body.sourceRegion],
      targetDetails: REGION_CONFIGS[body.targetRegion],
    },
  });
});

// ─── GET /api/v1/data-residency/regions/available ────────────
// List all available data residency regions
app.get('/regions/available', async (c) => {
  return c.json({
    success: true,
    data: {
      regions: Object.entries(REGION_CONFIGS).map(([id, config]) => ({
        id,
        ...config,
        status: id === 'us' ? 'active' : 'provisioning',
        features: {
          dedicatedInfrastructure: true,
          dataIsolation: true,
          complianceCertifications: id === 'us' 
            ? ['SOC 2 Type II (planned)', 'HIPAA (planned)']
            : ['GDPR', 'SOC 2 Type II (planned)', 'ISO 27001 (planned)'],
        },
      })),
      transferFrameworks: [
        {
          name: 'EU-US Data Privacy Framework',
          status: 'active',
          description: 'Allows lawful transfer of personal data from the EU to the US',
        },
        {
          name: 'Standard Contractual Clauses (SCCs)',
          status: 'active',
          description: 'Supplementary safeguards for international data transfers',
        },
      ],
    },
  });
});

export { app as dataResidencyRoutes };
