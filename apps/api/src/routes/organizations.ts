// ============================================================
// SimpleBuild Pro — Organization & Invitation Routes
// CRUD for orgs, member management, invitation flows
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import crypto from 'crypto';
import { getDb } from '@simplebuildpro/db';
import { organizations, orgMembers, users } from '@simplebuildpro/db';
import { eq, and, desc } from 'drizzle-orm';
import { AppError } from '../middleware/error-handler';
import { requireAuth } from '../middleware/auth';
import type { AuthEnv } from '../middleware/auth';
import { rateLimiter } from '../middleware/rate-limiter';

export const orgRoutes = new Hono<AuthEnv>();

orgRoutes.use('*', requireAuth);
orgRoutes.use('*', rateLimiter('api'));

// ─── Schema for org_invitations (inline to avoid import issues) ─
// We use raw SQL for the invitations table since it may not be in the Drizzle schema yet
import { sql } from 'drizzle-orm';

// ─── Create Organization ─────────────────────────────────────
const createOrgSchema = z.object({
  name: z.string().min(2).max(100),
  slug: z
    .string()
    .min(2)
    .max(48)
    .regex(/^[a-z0-9-]+$/),
});

orgRoutes.post('/', async (c) => {
  const session = c.get('session');
  const body = await c.req.json();
  const { name, slug } = createOrgSchema.parse(body);

  const db = getDb();

  // Check slug uniqueness
  const existing = await db.query.organizations.findFirst({
    where: eq(organizations.slug, slug),
  });
  if (existing) {
    throw new AppError(409, 'SLUG_TAKEN', 'This organization slug is already in use.');
  }

  // Create org
  const [org] = await db
    .insert(organizations)
    .values({
      name,
      slug,
      ownerId: session.userId,
      plan: session.plan || 'free',
    })
    .returning();

  // Add creator as owner member
  await db.insert(orgMembers).values({
    organizationId: org.id,
    userId: session.userId,
    role: 'owner',
  });

  // Update user's organizationId
  await db
    .update(users)
    .set({ organizationId: org.id, updatedAt: new Date() })
    .where(eq(users.id, session.userId));

  return c.json(
    {
      success: true,
      data: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        plan: org.plan,
        createdAt: org.createdAt.toISOString(),
      },
    },
    201,
  );
});

// ─── Get Organization ────────────────────────────────────────
orgRoutes.get('/:orgId', async (c) => {
  const session = c.get('session');
  const orgId = c.req.param('orgId');
  const db = getDb();

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });

  if (!org) throw new AppError(404, 'NOT_FOUND', 'Organization not found.');

  // Check membership
  const membership = await db.query.orgMembers.findFirst({
    where: and(eq(orgMembers.organizationId, orgId), eq(orgMembers.userId, session.userId)),
  });

  if (!membership)
    throw new AppError(403, 'FORBIDDEN', 'You are not a member of this organization.');

  return c.json({ success: true, data: org });
});

// ─── List Members ────────────────────────────────────────────
orgRoutes.get('/:orgId/members', async (c) => {
  const session = c.get('session');
  const orgId = c.req.param('orgId');
  const db = getDb();

  // Verify membership
  const membership = await db.query.orgMembers.findFirst({
    where: and(eq(orgMembers.organizationId, orgId), eq(orgMembers.userId, session.userId)),
  });

  if (!membership) throw new AppError(403, 'FORBIDDEN', 'Not a member of this organization.');

  const members = await db
    .select({
      id: orgMembers.id,
      role: orgMembers.role,
      createdAt: orgMembers.createdAt,
      userId: users.id,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
    })
    .from(orgMembers)
    .innerJoin(users, eq(orgMembers.userId, users.id))
    .where(eq(orgMembers.organizationId, orgId));

  return c.json({ success: true, data: members });
});

// ─── Update Member Role ──────────────────────────────────────
const updateRoleSchema = z.object({
  role: z.enum(['admin', 'editor', 'viewer']),
});

orgRoutes.patch('/:orgId/members/:memberId', async (c) => {
  const session = c.get('session');
  const orgId = c.req.param('orgId');
  const memberId = c.req.param('memberId');
  const body = await c.req.json();
  const { role } = updateRoleSchema.parse(body);

  const db = getDb();

  // Verify caller is owner or admin
  const callerMembership = await db.query.orgMembers.findFirst({
    where: and(eq(orgMembers.organizationId, orgId), eq(orgMembers.userId, session.userId)),
  });

  if (!callerMembership || !['owner', 'admin'].includes(callerMembership.role)) {
    throw new AppError(403, 'FORBIDDEN', 'Only owners and admins can change roles.');
  }

  // Cannot change owner role
  const targetMember = await db.query.orgMembers.findFirst({
    where: eq(orgMembers.id, memberId),
  });

  if (!targetMember) throw new AppError(404, 'NOT_FOUND', 'Member not found.');
  if (targetMember.role === 'owner')
    throw new AppError(400, 'CANNOT_CHANGE_OWNER', 'Cannot change the owner role.');

  await db.update(orgMembers).set({ role }).where(eq(orgMembers.id, memberId));

  return c.json({ success: true, data: { message: 'Role updated.' } });
});

// ─── Remove Member ───────────────────────────────────────────
orgRoutes.delete('/:orgId/members/:memberId', async (c) => {
  const session = c.get('session');
  const orgId = c.req.param('orgId');
  const memberId = c.req.param('memberId');

  const db = getDb();

  // Verify caller is owner or admin
  const callerMembership = await db.query.orgMembers.findFirst({
    where: and(eq(orgMembers.organizationId, orgId), eq(orgMembers.userId, session.userId)),
  });

  if (!callerMembership || !['owner', 'admin'].includes(callerMembership.role)) {
    throw new AppError(403, 'FORBIDDEN', 'Only owners and admins can remove members.');
  }

  const targetMember = await db.query.orgMembers.findFirst({
    where: eq(orgMembers.id, memberId),
  });

  if (!targetMember) throw new AppError(404, 'NOT_FOUND', 'Member not found.');
  if (targetMember.role === 'owner')
    throw new AppError(400, 'CANNOT_REMOVE_OWNER', 'Cannot remove the organization owner.');

  await db.delete(orgMembers).where(eq(orgMembers.id, memberId));

  return c.json({ success: true, data: { message: 'Member removed.' } });
});

// ─── Invite Member ───────────────────────────────────────────
const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'editor', 'viewer']).default('viewer'),
});

orgRoutes.post('/:orgId/invitations', async (c) => {
  const session = c.get('session');
  const orgId = c.req.param('orgId');
  const body = await c.req.json();
  const { email, role } = inviteSchema.parse(body);

  const db = getDb();

  // Verify caller is owner or admin
  const callerMembership = await db.query.orgMembers.findFirst({
    where: and(eq(orgMembers.organizationId, orgId), eq(orgMembers.userId, session.userId)),
  });

  if (!callerMembership || !['owner', 'admin'].includes(callerMembership.role)) {
    throw new AppError(403, 'FORBIDDEN', 'Only owners and admins can send invitations.');
  }

  // Check if user is already a member
  const existingUser = await db.query.users.findFirst({
    where: eq(users.email, email.toLowerCase()),
  });

  if (existingUser) {
    const existingMember = await db.query.orgMembers.findFirst({
      where: and(eq(orgMembers.organizationId, orgId), eq(orgMembers.userId, existingUser.id)),
    });
    if (existingMember) {
      throw new AppError(409, 'ALREADY_MEMBER', 'This user is already a member.');
    }
  }

  // Create invitation token
  const token = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  // Insert using raw SQL since org_invitations may not be in Drizzle schema
  await db.execute(sql`
    INSERT INTO org_invitations (id, organization_id, email, role, invited_by, token, expires_at)
    VALUES (gen_random_uuid(), ${orgId}, ${email.toLowerCase()}, ${role}, ${session.userId}, ${token}, ${expiresAt})
  `);

  // TODO: Send invitation email via SendGrid/Resend
  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/invite/${token}`;

  return c.json(
    {
      success: true,
      data: {
        email,
        role,
        inviteUrl,
        expiresAt: expiresAt.toISOString(),
        message: `Invitation sent to ${email}.`,
      },
    },
    201,
  );
});

// ─── Accept Invitation ───────────────────────────────────────
orgRoutes.post('/invitations/:token/accept', async (c) => {
  const session = c.get('session');
  const token = c.req.param('token');

  const db = getDb();

  // Find invitation
  const [invitation] = (await db.execute(sql`
    SELECT * FROM org_invitations WHERE token = ${token} AND accepted_at IS NULL
  `)) as unknown as any[];

  if (!invitation) {
    throw new AppError(404, 'INVITATION_NOT_FOUND', 'Invitation not found or already accepted.');
  }

  if (new Date(invitation.expires_at) < new Date()) {
    throw new AppError(410, 'INVITATION_EXPIRED', 'This invitation has expired.');
  }

  // Verify email matches
  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
  });

  if (!user || user.email !== invitation.email) {
    throw new AppError(
      403,
      'EMAIL_MISMATCH',
      'This invitation was sent to a different email address.',
    );
  }

  // Add as member
  await db.insert(orgMembers).values({
    organizationId: invitation.organization_id,
    userId: session.userId,
    role: invitation.role,
  });

  // Update user's org
  await db
    .update(users)
    .set({ organizationId: invitation.organization_id, updatedAt: new Date() })
    .where(eq(users.id, session.userId));

  // Mark invitation accepted
  await db.execute(sql`
    UPDATE org_invitations SET accepted_at = NOW() WHERE id = ${invitation.id}
  `);

  return c.json({ success: true, data: { message: 'Invitation accepted.' } });
});

// ─── List Pending Invitations ────────────────────────────────
orgRoutes.get('/:orgId/invitations', async (c) => {
  const session = c.get('session');
  const orgId = c.req.param('orgId');

  const db = getDb();

  // Verify membership
  const membership = await db.query.orgMembers.findFirst({
    where: and(eq(orgMembers.organizationId, orgId), eq(orgMembers.userId, session.userId)),
  });

  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    throw new AppError(403, 'FORBIDDEN', 'Only owners and admins can view invitations.');
  }

  const invitations = await db.execute(sql`
    SELECT id, email, role, expires_at, created_at
    FROM org_invitations
    WHERE organization_id = ${orgId} AND accepted_at IS NULL AND expires_at > NOW()
    ORDER BY created_at DESC
  `);

  return c.json({ success: true, data: invitations });
});

// ─── Revoke Invitation ───────────────────────────────────────
orgRoutes.delete('/:orgId/invitations/:invitationId', async (c) => {
  const session = c.get('session');
  const orgId = c.req.param('orgId');
  const invitationId = c.req.param('invitationId');

  const db = getDb();

  // Verify caller is owner or admin
  const membership = await db.query.orgMembers.findFirst({
    where: and(eq(orgMembers.organizationId, orgId), eq(orgMembers.userId, session.userId)),
  });

  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    throw new AppError(403, 'FORBIDDEN', 'Only owners and admins can revoke invitations.');
  }

  await db.execute(sql`
    DELETE FROM org_invitations WHERE id = ${invitationId} AND organization_id = ${orgId}
  `);

  return c.json({ success: true, data: { message: 'Invitation revoked.' } });
});
