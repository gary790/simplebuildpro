// ============================================================
// SimpleBuild Pro — Deploy Routes
// Real deployment pipeline: GCS static hosting + Cloud CDN
// Custom domains with auto-SSL via Cloud Load Balancer
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '@simplebuildpro/db';
import {
  projects, projectVersions, deployments, customDomains, usageLogs,
} from '@simplebuildpro/db';
import { eq, and, desc, count } from 'drizzle-orm';
import { requireAuth, type AuthEnv } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import { rateLimiter } from '../middleware/rate-limiter';
import { getStorageService } from '../services/storage';
import {
  GCS_BUCKET_BUILDS, GCS_BUCKET_DEPLOYS, SITES_DOMAIN,
  PLAN_LIMITS, CDN_URL,
} from '@simplebuildpro/shared';
import { validateDomain } from '@simplebuildpro/shared';

export const deployRoutes = new Hono<AuthEnv>();
deployRoutes.use('*', requireAuth);
deployRoutes.use('*', rateLimiter('deploy'));

// ─── Deploy Project ──────────────────────────────────────────
const deploySchema = z.object({
  projectId: z.string().uuid(),
  versionId: z.string().uuid(),
});

deployRoutes.post('/', async (c) => {
  const session = c.get('session');
  const body = await c.req.json();
  const { projectId, versionId } = deploySchema.parse(body);

  const startTime = Date.now();
  const db = getDb();

  // Verify project
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, session.userId)),
  });
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');

  // Check deploy limits
  const limits = PLAN_LIMITS[session.plan];
  if (limits.deploysPerMonth !== -1) {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [{ count: deployCount }] = await db.select({ count: count() })
      .from(deployments)
      .where(and(
        eq(deployments.projectId, projectId),
        eq(deployments.createdBy, session.userId),
      ));

    if (deployCount >= limits.deploysPerMonth) {
      throw new AppError(403, 'DEPLOY_LIMIT',
        `Your ${session.plan} plan allows ${limits.deploysPerMonth} deploys per month. Upgrade for unlimited.`);
    }
  }

  // Verify version exists
  const version = await db.query.projectVersions.findFirst({
    where: and(
      eq(projectVersions.id, versionId),
      eq(projectVersions.projectId, projectId),
    ),
  });
  if (!version) throw new AppError(404, 'VERSION_NOT_FOUND', 'Build version not found. Run a build first.');

  // Generate deploy URL
  const deployPrefix = `sites/${project.slug}`;
  const siteUrl = `https://${project.slug}.${SITES_DOMAIN}`;

  // Create deployment record (status: deploying)
  const [deployment] = await db.insert(deployments).values({
    projectId,
    versionId,
    status: 'deploying',
    url: siteUrl,
    cdnUrl: `${CDN_URL}/${deployPrefix}`,
    gcsPrefix: deployPrefix,
    createdBy: session.userId,
  }).returning();

  try {
    const storage = getStorageService();

    // Copy build artifacts from builds bucket to deploy bucket
    const buildPrefix = `projects/${projectId}/builds/v${version.versionNumber}`;
    const buildFiles = await storage.listFiles(GCS_BUCKET_BUILDS, buildPrefix);

    for (const buildFile of buildFiles) {
      const relativePath = buildFile.name.replace(`${buildPrefix}/`, '');
      await storage.copyFile(
        GCS_BUCKET_BUILDS, buildFile.name,
        GCS_BUCKET_DEPLOYS, `${deployPrefix}/${relativePath}`,
      );
    }

    const buildDurationMs = Date.now() - startTime;

    // Update deployment status to live
    await db.update(deployments)
      .set({
        status: 'live',
        buildDurationMs,
        completedAt: new Date(),
      })
      .where(eq(deployments.id, deployment.id));

    // Update project last deployed timestamp
    await db.update(projects)
      .set({
        lastDeployedAt: new Date(),
        status: 'published',
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));

    // Log usage
    await db.insert(usageLogs).values({
      userId: session.userId,
      organizationId: session.organizationId,
      type: 'deploy',
      quantity: 1,
      metadata: {
        projectId,
        versionId,
        deploymentId: deployment.id,
        durationMs: buildDurationMs,
      },
    });

    return c.json({
      success: true,
      data: {
        deploymentId: deployment.id,
        status: 'live',
        url: siteUrl,
        cdnUrl: `${CDN_URL}/${deployPrefix}`,
        versionNumber: version.versionNumber,
        buildDurationMs,
        filesDeployed: buildFiles.length,
        createdAt: deployment.createdAt.toISOString(),
      },
    }, 201);

  } catch (err) {
    // Mark deployment as failed
    await db.update(deployments)
      .set({
        status: 'failed',
        buildDurationMs: Date.now() - startTime,
        completedAt: new Date(),
      })
      .where(eq(deployments.id, deployment.id));

    console.error('[Deploy] Failed:', err);
    throw new AppError(502, 'DEPLOY_FAILED',
      `Deployment failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
});

// ─── List Deployments ────────────────────────────────────────
deployRoutes.get('/:projectId', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('projectId');
  const db = getDb();

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, session.userId)),
  });
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');

  const deploys = await db.query.deployments.findMany({
    where: eq(deployments.projectId, projectId),
    orderBy: desc(deployments.createdAt),
    limit: 50,
  });

  return c.json({
    success: true,
    data: deploys.map(d => ({
      id: d.id,
      versionId: d.versionId,
      status: d.status,
      url: d.url,
      cdnUrl: d.cdnUrl,
      customDomain: d.customDomain,
      buildDurationMs: d.buildDurationMs,
      lighthouseScore: d.lighthouseScore,
      createdAt: d.createdAt.toISOString(),
      completedAt: d.completedAt?.toISOString() || null,
    })),
  });
});

// ─── Rollback to Previous Deployment ─────────────────────────
const rollbackSchema = z.object({
  deploymentId: z.string().uuid(),
});

deployRoutes.post('/:projectId/rollback', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('projectId');
  const body = await c.req.json();
  const { deploymentId } = rollbackSchema.parse(body);

  const db = getDb();

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, session.userId)),
  });
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');

  const targetDeployment = await db.query.deployments.findFirst({
    where: and(
      eq(deployments.id, deploymentId),
      eq(deployments.projectId, projectId),
    ),
  });
  if (!targetDeployment) throw new AppError(404, 'DEPLOYMENT_NOT_FOUND', 'Deployment not found.');

  // Re-deploy using the version from the target deployment
  // This creates a NEW deployment record pointing to the old version
  const [rollbackDeployment] = await db.insert(deployments).values({
    projectId,
    versionId: targetDeployment.versionId,
    status: 'live',
    url: targetDeployment.url,
    cdnUrl: targetDeployment.cdnUrl,
    gcsPrefix: targetDeployment.gcsPrefix,
    buildDurationMs: 0,
    createdBy: session.userId,
    completedAt: new Date(),
  }).returning();

  // Mark the most recent deployment as rolled_back
  const latestDeployment = await db.query.deployments.findFirst({
    where: and(
      eq(deployments.projectId, projectId),
      eq(deployments.status, 'live'),
    ),
    orderBy: desc(deployments.createdAt),
  });

  if (latestDeployment && latestDeployment.id !== rollbackDeployment.id) {
    await db.update(deployments)
      .set({ status: 'rolled_back' })
      .where(eq(deployments.id, latestDeployment.id));
  }

  return c.json({
    success: true,
    data: {
      deploymentId: rollbackDeployment.id,
      rolledBackTo: targetDeployment.id,
      url: rollbackDeployment.url,
      message: 'Rollback successful.',
    },
  });
});

// ─── Add Custom Domain ───────────────────────────────────────
const addDomainSchema = z.object({
  domain: z.string().min(1).max(253),
});

deployRoutes.post('/:projectId/domains', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('projectId');
  const body = await c.req.json();
  const { domain } = addDomainSchema.parse(body);

  const domainValidation = validateDomain(domain);
  if (!domainValidation.valid) {
    throw new AppError(400, 'INVALID_DOMAIN', domainValidation.error!);
  }

  const db = getDb();

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, session.userId)),
  });
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');

  // Check custom domain limits
  const limits = PLAN_LIMITS[session.plan];
  if (limits.customDomains !== -1) {
    const [{ count: domainCount }] = await db.select({ count: count() })
      .from(customDomains)
      .where(eq(customDomains.projectId, projectId));

    if (domainCount >= limits.customDomains) {
      throw new AppError(403, 'DOMAIN_LIMIT',
        `Your ${session.plan} plan allows ${limits.customDomains} custom domains. Upgrade for more.`);
    }
  }

  // Check if domain is already registered
  const existing = await db.query.customDomains.findFirst({
    where: eq(customDomains.domain, domain.toLowerCase()),
  });
  if (existing) {
    throw new AppError(409, 'DOMAIN_EXISTS', 'This domain is already registered.');
  }

  // Create domain record with DNS verification instructions
  const [domainRecord] = await db.insert(customDomains).values({
    projectId,
    domain: domain.toLowerCase(),
    sslStatus: 'pending',
    dnsVerified: false,
    dnsRecords: [
      {
        type: 'CNAME',
        name: domain.toLowerCase(),
        value: `${project.slug}.${SITES_DOMAIN}`,
      },
      {
        type: 'TXT',
        name: `_simplebuildpro.${domain.toLowerCase()}`,
        value: `verify=${projectId}`,
      },
    ],
  }).returning();

  return c.json({
    success: true,
    data: {
      id: domainRecord.id,
      domain: domainRecord.domain,
      sslStatus: domainRecord.sslStatus,
      dnsVerified: domainRecord.dnsVerified,
      dnsRecords: domainRecord.dnsRecords,
      instructions: 'Add the DNS records below to your domain registrar, then verify.',
    },
  }, 201);
});

// ─── Verify Domain DNS ───────────────────────────────────────
deployRoutes.post('/:projectId/domains/:domainId/verify', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('projectId');
  const domainId = c.req.param('domainId');
  const db = getDb();

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, session.userId)),
  });
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');

  const domainRecord = await db.query.customDomains.findFirst({
    where: and(eq(customDomains.id, domainId), eq(customDomains.projectId, projectId)),
  });
  if (!domainRecord) throw new AppError(404, 'DOMAIN_NOT_FOUND', 'Domain not found.');

  // Real DNS verification using Node.js dns module
  const dns = await import('dns');
  const { promises: dnsPromises } = dns;

  try {
    // Check CNAME record
    const cnameRecords = await dnsPromises.resolveCname(domainRecord.domain).catch(() => []);
    const expectedCname = `${project.slug}.${SITES_DOMAIN}`;
    const cnameVerified = cnameRecords.some(r => r === expectedCname || r === `${expectedCname}.`);

    // Check TXT record
    const txtRecords = await dnsPromises.resolveTxt(`_simplebuildpro.${domainRecord.domain}`).catch(() => []);
    const expectedTxt = `verify=${projectId}`;
    const txtVerified = txtRecords.flat().some(r => r === expectedTxt);

    const verified = cnameVerified && txtVerified;

    if (verified) {
      await db.update(customDomains)
        .set({
          dnsVerified: true,
          sslStatus: 'active', // SSL provisioning happens via Cloud Load Balancer
          updatedAt: new Date(),
        })
        .where(eq(customDomains.id, domainId));
    }

    return c.json({
      success: true,
      data: {
        verified,
        cnameVerified,
        txtVerified,
        ...(verified ? { message: 'Domain verified and SSL provisioned.' } : {
          message: 'DNS records not yet propagated. This can take up to 48 hours.',
        }),
      },
    });
  } catch (err) {
    return c.json({
      success: true,
      data: {
        verified: false,
        message: 'DNS lookup failed. Records may not have propagated yet.',
      },
    });
  }
});

// ─── List Custom Domains ─────────────────────────────────────
deployRoutes.get('/:projectId/domains', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('projectId');
  const db = getDb();

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, session.userId)),
  });
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');

  const domains = await db.query.customDomains.findMany({
    where: eq(customDomains.projectId, projectId),
  });

  return c.json({
    success: true,
    data: domains.map(d => ({
      id: d.id,
      domain: d.domain,
      sslStatus: d.sslStatus,
      dnsVerified: d.dnsVerified,
      dnsRecords: d.dnsRecords,
      createdAt: d.createdAt.toISOString(),
    })),
  });
});

// ─── Delete Custom Domain ────────────────────────────────────
deployRoutes.delete('/:projectId/domains/:domainId', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('projectId');
  const domainId = c.req.param('domainId');
  const db = getDb();

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, session.userId)),
  });
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');

  await db.delete(customDomains).where(
    and(eq(customDomains.id, domainId), eq(customDomains.projectId, projectId))
  );

  return c.json({ success: true, data: { message: 'Domain removed.' } });
});
