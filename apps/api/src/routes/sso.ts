// ============================================================
// SimpleBuild Pro — SSO (SAML 2.0 / OIDC) Routes
// Enterprise single sign-on integration
// Phase 5.1a: Scale & Enterprise
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import crypto from 'crypto';
import { getDb } from '@simplebuildpro/db';
import { users, organizations, orgMembers } from '@simplebuildpro/db';
import { eq, and, sql } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth';
import type { AuthEnv } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import { generateAccessToken, generateRefreshToken } from '../middleware/auth';
import { auditLog, getAuditContext } from '../services/audit';
import { logger } from '../services/logger';
import { cache, CACHE_TTL } from '../services/cache';

export const ssoRoutes = new Hono<AuthEnv>();

// ─── SSO Configuration Schema ────────────────────────────────────────────────
const ssoConfigSchema = z.object({
  provider: z.enum(['saml', 'oidc']),
  // SAML settings
  entityId: z.string().url().optional(),
  ssoUrl: z.string().url().optional(),
  certificate: z.string().optional(),
  // OIDC settings
  issuer: z.string().url().optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  discoveryUrl: z.string().url().optional(),
  // Common
  allowedDomains: z.array(z.string()).min(1),
  autoProvision: z.boolean().default(true),
  defaultRole: z.enum(['admin', 'editor', 'viewer']).default('viewer'),
});

// ─── Get SSO Config for Org ──────────────────────────────────────────────────
ssoRoutes.get('/config/:orgId', requireAuth, async (c) => {
  const session = c.get('session');
  const orgId = c.req.param('orgId');
  const db = getDb();

  // Verify caller is org owner or admin
  const membership = await db.query.orgMembers.findFirst({
    where: and(eq(orgMembers.organizationId, orgId), eq(orgMembers.userId, session.userId)),
  });

  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    throw new AppError(403, 'FORBIDDEN', 'Only org owners/admins can manage SSO.');
  }

  // Check plan
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });

  if (!org || (org.plan !== 'enterprise' && org.plan !== 'business')) {
    throw new AppError(403, 'PLAN_REQUIRED', 'SSO requires a Business or Enterprise plan.');
  }

  // Get SSO config from org_sso_configs table
  const [config] = (await db.execute(sql`
    SELECT * FROM org_sso_configs WHERE organization_id = ${orgId}
  `)) as any[];

  if (!config) {
    return c.json({
      success: true,
      data: {
        configured: false,
        provider: null,
        ssoUrl: null,
        allowedDomains: [],
      },
    });
  }

  return c.json({
    success: true,
    data: {
      configured: true,
      provider: config.provider,
      entityId: config.entity_id,
      ssoUrl: config.sso_url,
      issuer: config.issuer,
      clientId: config.client_id,
      discoveryUrl: config.discovery_url,
      allowedDomains: config.allowed_domains,
      autoProvision: config.auto_provision,
      defaultRole: config.default_role,
      updatedAt: config.updated_at,
      // Never return certificate or client_secret
    },
  });
});

// ─── Configure SSO ───────────────────────────────────────────────────────────
ssoRoutes.put('/config/:orgId', requireAuth, async (c) => {
  const session = c.get('session');
  const orgId = c.req.param('orgId');
  const body = await c.req.json();
  const config = ssoConfigSchema.parse(body);

  const db = getDb();

  // Verify org owner
  const membership = await db.query.orgMembers.findFirst({
    where: and(eq(orgMembers.organizationId, orgId), eq(orgMembers.userId, session.userId)),
  });

  if (!membership || membership.role !== 'owner') {
    throw new AppError(403, 'FORBIDDEN', 'Only org owners can configure SSO.');
  }

  // Validate provider-specific fields
  if (config.provider === 'saml') {
    if (!config.entityId || !config.ssoUrl || !config.certificate) {
      throw new AppError(
        400,
        'MISSING_SAML_CONFIG',
        'SAML requires entityId, ssoUrl, and certificate.',
      );
    }
  } else if (config.provider === 'oidc') {
    if (!config.issuer || !config.clientId || !config.clientSecret) {
      throw new AppError(
        400,
        'MISSING_OIDC_CONFIG',
        'OIDC requires issuer, clientId, and clientSecret.',
      );
    }
  }

  // Encrypt sensitive fields
  const encryptionKey = process.env.ENCRYPTION_KEY;
  const encryptedCert = config.certificate ? encryptField(config.certificate, encryptionKey) : null;
  const encryptedSecret = config.clientSecret
    ? encryptField(config.clientSecret, encryptionKey)
    : null;

  // Upsert SSO config
  await db.execute(sql`
    INSERT INTO org_sso_configs (id, organization_id, provider, entity_id, sso_url, certificate_encrypted, issuer, client_id, client_secret_encrypted, discovery_url, allowed_domains, auto_provision, default_role, updated_at)
    VALUES (
      gen_random_uuid(), ${orgId}, ${config.provider},
      ${config.entityId || null}, ${config.ssoUrl || null}, ${encryptedCert},
      ${config.issuer || null}, ${config.clientId || null}, ${encryptedSecret},
      ${config.discoveryUrl || null},
      ${JSON.stringify(config.allowedDomains)}::jsonb,
      ${config.autoProvision}, ${config.defaultRole}, NOW()
    )
    ON CONFLICT (organization_id) DO UPDATE SET
      provider = EXCLUDED.provider,
      entity_id = EXCLUDED.entity_id,
      sso_url = EXCLUDED.sso_url,
      certificate_encrypted = EXCLUDED.certificate_encrypted,
      issuer = EXCLUDED.issuer,
      client_id = EXCLUDED.client_id,
      client_secret_encrypted = EXCLUDED.client_secret_encrypted,
      discovery_url = EXCLUDED.discovery_url,
      allowed_domains = EXCLUDED.allowed_domains,
      auto_provision = EXCLUDED.auto_provision,
      default_role = EXCLUDED.default_role,
      updated_at = NOW()
  `);

  const ctx = getAuditContext(c);
  auditLog.log({
    ...ctx,
    action: 'admin.sso_config_update',
    resourceType: 'organization',
    resourceId: orgId,
    metadata: { provider: config.provider, allowedDomains: config.allowedDomains },
  });

  return c.json({
    success: true,
    data: { message: `SSO (${config.provider.toUpperCase()}) configured successfully.` },
  });
});

// ─── SSO Login Initiation ────────────────────────────────────────────────────
// The frontend redirects users here; we redirect to the IdP
ssoRoutes.get('/login/:orgSlug', async (c) => {
  const orgSlug = c.req.param('orgSlug');
  const db = getDb();

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.slug, orgSlug),
  });

  if (!org) {
    throw new AppError(404, 'ORG_NOT_FOUND', 'Organization not found.');
  }

  const [ssoConfig] = (await db.execute(sql`
    SELECT * FROM org_sso_configs WHERE organization_id = ${org.id}
  `)) as any[];

  if (!ssoConfig) {
    throw new AppError(404, 'SSO_NOT_CONFIGURED', 'SSO is not configured for this organization.');
  }

  // Generate state token for CSRF protection
  const state = crypto.randomBytes(32).toString('base64url');
  await cache.set(`sso:state:${state}`, { orgId: org.id, orgSlug }, 600); // 10 min TTL

  if (ssoConfig.provider === 'saml') {
    // Build SAML AuthnRequest
    const samlRequest = buildSAMLAuthnRequest(ssoConfig.entity_id, ssoConfig.sso_url, state);
    const redirectUrl = `${ssoConfig.sso_url}?SAMLRequest=${encodeURIComponent(samlRequest)}&RelayState=${state}`;
    return c.redirect(redirectUrl);
  } else if (ssoConfig.provider === 'oidc') {
    // Build OIDC authorization URL
    const redirectUri = `${process.env.API_URL || 'https://api.simplebuildpro.com'}/api/v1/sso/callback/oidc`;
    const params = new URLSearchParams({
      client_id: ssoConfig.client_id,
      response_type: 'code',
      scope: 'openid email profile',
      redirect_uri: redirectUri,
      state,
      nonce: crypto.randomBytes(16).toString('hex'),
    });

    const authUrl = ssoConfig.discovery_url
      ? `${ssoConfig.issuer}/authorize?${params.toString()}`
      : `${ssoConfig.issuer}/authorize?${params.toString()}`;

    return c.redirect(authUrl);
  }

  throw new AppError(400, 'INVALID_SSO_PROVIDER', 'Unknown SSO provider.');
});

// ─── OIDC Callback ───────────────────────────────────────────────────────────
ssoRoutes.get('/callback/oidc', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');

  if (!code || !state) {
    throw new AppError(400, 'INVALID_CALLBACK', 'Missing code or state parameter.');
  }

  // Verify state
  const stateData = await cache.get<{ orgId: string; orgSlug: string }>(`sso:state:${state}`);
  if (!stateData) {
    throw new AppError(400, 'INVALID_STATE', 'Invalid or expired SSO state. Please try again.');
  }

  const db = getDb();
  const [ssoConfig] = (await db.execute(sql`
    SELECT * FROM org_sso_configs WHERE organization_id = ${stateData.orgId}
  `)) as any[];

  if (!ssoConfig) {
    throw new AppError(500, 'SSO_CONFIG_MISSING', 'SSO configuration not found.');
  }

  // Exchange code for tokens
  const encryptionKey = process.env.ENCRYPTION_KEY;
  const clientSecret = decryptField(ssoConfig.client_secret_encrypted, encryptionKey);

  const redirectUri = `${process.env.API_URL || 'https://api.simplebuildpro.com'}/api/v1/sso/callback/oidc`;
  const tokenResponse = await fetch(`${ssoConfig.issuer}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: ssoConfig.client_id,
      client_secret: clientSecret,
    }),
  });

  if (!tokenResponse.ok) {
    logger.error('[SSO] Token exchange failed', { status: tokenResponse.status });
    throw new AppError(
      502,
      'SSO_TOKEN_ERROR',
      'Failed to exchange SSO token with identity provider.',
    );
  }

  const tokenData = (await tokenResponse.json()) as any;

  // Fetch user info
  const userInfoResponse = await fetch(`${ssoConfig.issuer}/userinfo`, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!userInfoResponse.ok) {
    throw new AppError(
      502,
      'SSO_USERINFO_ERROR',
      'Failed to fetch user info from identity provider.',
    );
  }

  const userInfo = (await userInfoResponse.json()) as any;
  const email = userInfo.email?.toLowerCase();
  const name = userInfo.name || userInfo.preferred_username || email;

  if (!email) {
    throw new AppError(400, 'SSO_NO_EMAIL', 'Identity provider did not return an email address.');
  }

  // Verify email domain is allowed
  const emailDomain = email.split('@')[1];
  const allowedDomains = ssoConfig.allowed_domains || [];
  if (!allowedDomains.includes(emailDomain)) {
    throw new AppError(
      403,
      'SSO_DOMAIN_NOT_ALLOWED',
      `Email domain ${emailDomain} is not authorized for this organization.`,
    );
  }

  // Find or create user
  let user = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (!user && ssoConfig.auto_provision) {
    // Auto-provision new user
    const [newUser] = await db
      .insert(users)
      .values({
        email,
        name,
        passwordHash: crypto.randomBytes(64).toString('hex'), // Random hash — SSO users don't use passwords
        plan: 'free',
        organizationId: stateData.orgId,
        emailVerified: true, // SSO verifies email
      })
      .returning();

    // Add as org member with default role
    await db.insert(orgMembers).values({
      organizationId: stateData.orgId,
      userId: newUser.id,
      role: ssoConfig.default_role || 'viewer',
    });

    user = newUser;

    auditLog.log({
      userId: newUser.id,
      action: 'auth.signup',
      resourceType: 'user',
      resourceId: newUser.id,
      metadata: { method: 'sso_oidc', orgId: stateData.orgId },
      ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
      userAgent: c.req.header('user-agent') || 'unknown',
      organizationId: stateData.orgId,
    });
  } else if (!user) {
    throw new AppError(
      403,
      'SSO_NO_ACCOUNT',
      'No account found. Auto-provisioning is disabled for this organization.',
    );
  }

  // Ensure user is org member
  const membership = await db.query.orgMembers.findFirst({
    where: and(eq(orgMembers.organizationId, stateData.orgId), eq(orgMembers.userId, user.id)),
  });

  if (!membership && ssoConfig.auto_provision) {
    await db.insert(orgMembers).values({
      organizationId: stateData.orgId,
      userId: user.id,
      role: ssoConfig.default_role || 'viewer',
    });
  }

  // Update last login
  await db
    .update(users)
    .set({ lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, user.id));

  // Generate tokens
  const accessToken = generateAccessToken({
    id: user.id,
    email: user.email,
    name: user.name,
    plan: user.plan,
    organizationId: stateData.orgId,
  });
  const refreshToken = generateRefreshToken(user.id);

  // Log SSO login
  auditLog.log({
    userId: user.id,
    action: 'auth.sso_login',
    resourceType: 'user',
    resourceId: user.id,
    metadata: { provider: 'oidc', orgId: stateData.orgId },
    ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
    userAgent: c.req.header('user-agent') || 'unknown',
    organizationId: stateData.orgId,
  });

  // Clean up state
  await cache.del(`sso:state:${state}`);

  // Redirect to app with tokens (via fragment to keep out of server logs)
  const appUrl = process.env.APP_URL || 'https://app.simplebuildpro.com';
  return c.redirect(
    `${appUrl}/auth/sso-callback#access_token=${accessToken}&refresh_token=${refreshToken}`,
  );
});

// ─── SAML ACS (Assertion Consumer Service) ───────────────────────────────────
ssoRoutes.post('/callback/saml', async (c) => {
  // SAML responses come as POST with SAMLResponse in the body
  const formData = await c.req.parseBody();
  const samlResponse = formData['SAMLResponse'] as string;
  const relayState = formData['RelayState'] as string;

  if (!samlResponse || !relayState) {
    throw new AppError(400, 'INVALID_SAML_RESPONSE', 'Missing SAMLResponse or RelayState.');
  }

  // Verify state
  const stateData = await cache.get<{ orgId: string; orgSlug: string }>(`sso:state:${relayState}`);
  if (!stateData) {
    throw new AppError(400, 'INVALID_STATE', 'Invalid or expired SSO state. Please try again.');
  }

  // Decode SAML Response (base64)
  const decodedResponse = Buffer.from(samlResponse, 'base64').toString('utf-8');

  // Basic SAML assertion parsing (production should use a proper SAML library)
  // Extract email from NameID or AttributeStatement
  const emailMatch = decodedResponse.match(/<saml:NameID[^>]*>([^<]+)<\/saml:NameID>/);
  const nameMatch = decodedResponse.match(
    /<saml:Attribute Name="[^"]*name[^"]*"[^>]*>[\s\S]*?<saml:AttributeValue[^>]*>([^<]+)<\/saml:AttributeValue>/i,
  );

  const email = emailMatch?.[1]?.toLowerCase();
  const name = nameMatch?.[1] || email;

  if (!email) {
    logger.error('[SSO] SAML: Could not extract email from assertion');
    throw new AppError(400, 'SAML_NO_EMAIL', 'Could not extract email from SAML assertion.');
  }

  // The rest follows same logic as OIDC callback (find/create user, generate tokens)
  const db = getDb();

  const [ssoConfig] = (await db.execute(sql`
    SELECT * FROM org_sso_configs WHERE organization_id = ${stateData.orgId}
  `)) as any[];

  if (!ssoConfig) {
    throw new AppError(500, 'SSO_CONFIG_MISSING', 'SSO configuration not found.');
  }

  // Verify email domain
  const emailDomain = email.split('@')[1];
  const allowedDomains = ssoConfig.allowed_domains || [];
  if (!allowedDomains.includes(emailDomain)) {
    throw new AppError(
      403,
      'SSO_DOMAIN_NOT_ALLOWED',
      `Email domain ${emailDomain} is not authorized.`,
    );
  }

  // Find or create user (same as OIDC flow)
  let user = await db.query.users.findFirst({ where: eq(users.email, email) });

  if (!user && ssoConfig.auto_provision) {
    const [newUser] = await db
      .insert(users)
      .values({
        email,
        name: name || email,
        passwordHash: crypto.randomBytes(64).toString('hex'),
        plan: 'free',
        organizationId: stateData.orgId,
        emailVerified: true,
      })
      .returning();

    await db.insert(orgMembers).values({
      organizationId: stateData.orgId,
      userId: newUser.id,
      role: ssoConfig.default_role || 'viewer',
    });

    user = newUser;
  } else if (!user) {
    throw new AppError(403, 'SSO_NO_ACCOUNT', 'No account found. Auto-provisioning is disabled.');
  }

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

  const accessToken = generateAccessToken({
    id: user.id,
    email: user.email,
    name: user.name,
    plan: user.plan,
    organizationId: stateData.orgId,
  });
  const refreshToken = generateRefreshToken(user.id);

  auditLog.log({
    userId: user.id,
    action: 'auth.sso_login',
    metadata: { provider: 'saml', orgId: stateData.orgId },
    ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
    userAgent: c.req.header('user-agent') || 'unknown',
    organizationId: stateData.orgId,
  });

  await cache.del(`sso:state:${relayState}`);

  const appUrl = process.env.APP_URL || 'https://app.simplebuildpro.com';
  return c.redirect(
    `${appUrl}/auth/sso-callback#access_token=${accessToken}&refresh_token=${refreshToken}`,
  );
});

// ─── Delete SSO Config ───────────────────────────────────────────────────────
ssoRoutes.delete('/config/:orgId', requireAuth, async (c) => {
  const session = c.get('session');
  const orgId = c.req.param('orgId');
  const db = getDb();

  const membership = await db.query.orgMembers.findFirst({
    where: and(eq(orgMembers.organizationId, orgId), eq(orgMembers.userId, session.userId)),
  });

  if (!membership || membership.role !== 'owner') {
    throw new AppError(403, 'FORBIDDEN', 'Only org owners can delete SSO configuration.');
  }

  await db.execute(sql`DELETE FROM org_sso_configs WHERE organization_id = ${orgId}`);

  auditLog.log({
    ...getAuditContext(c),
    action: 'admin.sso_config_update',
    resourceType: 'organization',
    resourceId: orgId,
    metadata: { action: 'deleted' },
  });

  return c.json({ success: true, data: { message: 'SSO configuration deleted.' } });
});

// ─── SAML Metadata Endpoint ──────────────────────────────────────────────────
ssoRoutes.get('/metadata/:orgSlug', async (c) => {
  const apiUrl = process.env.API_URL || 'https://api.simplebuildpro.com';
  const orgSlug = c.req.param('orgSlug');

  const metadata = `<?xml version="1.0" encoding="UTF-8"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata"
  entityID="${apiUrl}/api/v1/sso/metadata/${orgSlug}">
  <SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true"
    protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</NameIDFormat>
    <AssertionConsumerService
      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
      Location="${apiUrl}/api/v1/sso/callback/saml"
      index="1"/>
  </SPSSODescriptor>
</EntityDescriptor>`;

  return new Response(metadata, {
    headers: { 'Content-Type': 'application/xml' },
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function buildSAMLAuthnRequest(entityId: string, _ssoUrl: string, state: string): string {
  const id = `_${crypto.randomBytes(16).toString('hex')}`;
  const issueInstant = new Date().toISOString();
  const apiUrl = process.env.API_URL || 'https://api.simplebuildpro.com';

  const request = `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
    ID="${id}"
    Version="2.0"
    IssueInstant="${issueInstant}"
    AssertionConsumerServiceURL="${apiUrl}/api/v1/sso/callback/saml"
    Destination="${entityId}">
    <saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">${apiUrl}/api/v1/sso/metadata/${state}</saml:Issuer>
  </samlp:AuthnRequest>`;

  return Buffer.from(request).toString('base64');
}

function encryptField(value: string, key?: string): string {
  if (!key) return value; // Fallback: store unencrypted (dev only)
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key, 'hex').slice(0, 32), iv);
  let encrypted = cipher.update(value, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

function decryptField(encrypted: string, key?: string): string {
  if (!key || !encrypted.includes(':')) return encrypted;
  const [ivHex, data] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key, 'hex').slice(0, 32), iv);
  let decrypted = decipher.update(data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
