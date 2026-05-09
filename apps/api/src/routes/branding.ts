// ============================================================
// SimpleBuild Pro — Organization Branding Routes
// Custom branding / white-label settings per organization
// Phase 5.1d: Scale & Enterprise
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '@simplebuildpro/db';
import { orgMembers, organizations } from '@simplebuildpro/db';
import { eq, and, sql } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth';
import type { AuthEnv } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import { auditLog, getAuditContext } from '../services/audit';
import { cache, CACHE_TTL } from '../services/cache';

export const brandingRoutes = new Hono<AuthEnv>();
brandingRoutes.use('*', requireAuth);

// ─── Validation Schema ──────────────────────────────────────────────────────
const brandingSchema = z.object({
  logoUrl: z.string().url().max(2048).optional().nullable(),
  faviconUrl: z.string().url().max(2048).optional().nullable(),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Must be a valid hex color (e.g. #2563eb)')
    .optional()
    .nullable(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Must be a valid hex color')
    .optional()
    .nullable(),
  customDomain: z.string().max(253).optional().nullable(),
  customCss: z.string().max(10000).optional().nullable(),
  footerText: z.string().max(255).optional().nullable(),
  supportEmail: z.string().email().max(255).optional().nullable(),
  supportUrl: z.string().url().max(2048).optional().nullable(),
  hideSimpleBuildBranding: z.boolean().optional(),
});

// ─── Get Branding Config ────────────────────────────────────────────────────
brandingRoutes.get('/:orgId', async (c) => {
  const session = c.get('session');
  const orgId = c.req.param('orgId');
  const db = getDb();

  // Verify caller is org member
  const membership = await db.query.orgMembers.findFirst({
    where: and(eq(orgMembers.organizationId, orgId), eq(orgMembers.userId, session.userId)),
  });

  if (!membership) {
    throw new AppError(403, 'FORBIDDEN', 'You are not a member of this organization.');
  }

  // Check cache first
  const cacheKey = `branding:${orgId}`;
  const cached = await cache.get<any>(cacheKey);
  if (cached) {
    return c.json({ success: true, data: cached }, 200, { 'X-Cache': 'HIT' });
  }

  const [branding] = (await db.execute(sql`
    SELECT * FROM org_branding WHERE organization_id = ${orgId}
  `)) as any[];

  const data = branding
    ? {
        configured: true,
        logoUrl: branding.logo_url,
        faviconUrl: branding.favicon_url,
        primaryColor: branding.primary_color,
        accentColor: branding.accent_color,
        customDomain: branding.custom_domain,
        customCss: branding.custom_css,
        footerText: branding.footer_text,
        supportEmail: branding.support_email,
        supportUrl: branding.support_url,
        hideSimpleBuildBranding: branding.hide_simplebuild_branding,
        updatedAt: branding.updated_at,
      }
    : {
        configured: false,
        logoUrl: null,
        faviconUrl: null,
        primaryColor: '#2563eb',
        accentColor: '#7c3aed',
        customDomain: null,
        customCss: null,
        footerText: null,
        supportEmail: null,
        supportUrl: null,
        hideSimpleBuildBranding: false,
      };

  await cache.set(cacheKey, data, CACHE_TTL.MEDIUM);

  return c.json({ success: true, data }, 200, { 'X-Cache': 'MISS' });
});

// ─── Update Branding Config ─────────────────────────────────────────────────
brandingRoutes.put('/:orgId', async (c) => {
  const session = c.get('session');
  const orgId = c.req.param('orgId');
  const body = await c.req.json();
  const updates = brandingSchema.parse(body);
  const db = getDb();

  // Verify org owner or admin
  const membership = await db.query.orgMembers.findFirst({
    where: and(eq(orgMembers.organizationId, orgId), eq(orgMembers.userId, session.userId)),
  });

  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    throw new AppError(403, 'FORBIDDEN', 'Only org owners/admins can manage branding.');
  }

  // Check plan — white-label requires business or enterprise
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });

  if (!org) {
    throw new AppError(404, 'ORG_NOT_FOUND', 'Organization not found.');
  }

  if (updates.hideSimpleBuildBranding && org.plan !== 'enterprise') {
    throw new AppError(
      403,
      'PLAN_REQUIRED',
      'Hiding SimpleBuild branding requires an Enterprise plan.',
    );
  }

  if (updates.customDomain && !['business', 'enterprise'].includes(org.plan)) {
    throw new AppError(
      403,
      'PLAN_REQUIRED',
      'Custom branding domain requires a Business or Enterprise plan.',
    );
  }

  // Upsert branding config
  await db.execute(sql`
    INSERT INTO org_branding (id, organization_id, logo_url, favicon_url, primary_color, accent_color, custom_domain, custom_css, footer_text, support_email, support_url, hide_simplebuild_branding, updated_at)
    VALUES (
      gen_random_uuid(), ${orgId},
      ${updates.logoUrl || null}, ${updates.faviconUrl || null},
      ${updates.primaryColor || '#2563eb'}, ${updates.accentColor || '#7c3aed'},
      ${updates.customDomain || null}, ${updates.customCss || null},
      ${updates.footerText || null}, ${updates.supportEmail || null},
      ${updates.supportUrl || null}, ${updates.hideSimpleBuildBranding || false},
      NOW()
    )
    ON CONFLICT (organization_id) DO UPDATE SET
      logo_url = EXCLUDED.logo_url,
      favicon_url = EXCLUDED.favicon_url,
      primary_color = EXCLUDED.primary_color,
      accent_color = EXCLUDED.accent_color,
      custom_domain = EXCLUDED.custom_domain,
      custom_css = EXCLUDED.custom_css,
      footer_text = EXCLUDED.footer_text,
      support_email = EXCLUDED.support_email,
      support_url = EXCLUDED.support_url,
      hide_simplebuild_branding = EXCLUDED.hide_simplebuild_branding,
      updated_at = NOW()
  `);

  // Invalidate cache
  await cache.del(`branding:${orgId}`);

  const ctx = getAuditContext(c);
  auditLog.log({
    ...ctx,
    action: 'org.update',
    resourceType: 'organization',
    resourceId: orgId,
    metadata: { type: 'branding_update', fields: Object.keys(updates) },
  });

  return c.json({
    success: true,
    data: { message: 'Branding settings updated successfully.' },
  });
});

// ─── Delete Branding Config ─────────────────────────────────────────────────
brandingRoutes.delete('/:orgId', async (c) => {
  const session = c.get('session');
  const orgId = c.req.param('orgId');
  const db = getDb();

  const membership = await db.query.orgMembers.findFirst({
    where: and(eq(orgMembers.organizationId, orgId), eq(orgMembers.userId, session.userId)),
  });

  if (!membership || membership.role !== 'owner') {
    throw new AppError(403, 'FORBIDDEN', 'Only org owners can reset branding.');
  }

  await db.execute(sql`DELETE FROM org_branding WHERE organization_id = ${orgId}`);
  await cache.del(`branding:${orgId}`);

  auditLog.log({
    ...getAuditContext(c),
    action: 'org.update',
    resourceType: 'organization',
    resourceId: orgId,
    metadata: { type: 'branding_reset' },
  });

  return c.json({ success: true, data: { message: 'Branding reset to defaults.' } });
});

// ─── Public: Get Branding by Org Slug (for white-label rendering) ───────────
// No auth required — used by frontend to load org branding on login page, etc.
brandingRoutes.get('/public/:orgSlug', async (c) => {
  const orgSlug = c.req.param('orgSlug');
  const db = getDb();

  const cacheKey = `branding:public:${orgSlug}`;
  const cached = await cache.get<any>(cacheKey);
  if (cached) {
    return c.json({ success: true, data: cached }, 200, { 'X-Cache': 'HIT' });
  }

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.slug, orgSlug),
  });

  if (!org) {
    return c.json({
      success: true,
      data: { configured: false, orgName: null },
    });
  }

  const [branding] = (await db.execute(sql`
    SELECT logo_url, favicon_url, primary_color, accent_color, custom_css, footer_text, support_email, support_url, hide_simplebuild_branding
    FROM org_branding WHERE organization_id = ${org.id}
  `)) as any[];

  const data = branding
    ? {
        configured: true,
        orgName: org.name,
        logoUrl: branding.logo_url,
        faviconUrl: branding.favicon_url,
        primaryColor: branding.primary_color,
        accentColor: branding.accent_color,
        customCss: branding.custom_css,
        footerText: branding.footer_text,
        supportEmail: branding.support_email,
        supportUrl: branding.support_url,
        hideSimpleBuildBranding: branding.hide_simplebuild_branding,
      }
    : { configured: false, orgName: org.name };

  await cache.set(cacheKey, data, CACHE_TTL.LONG);

  return c.json({ success: true, data }, 200, { 'X-Cache': 'MISS' });
});
