// ============================================================
// SimpleBuild Pro — Auth Routes
// Real authentication: signup, login, refresh, OAuth
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getDb } from '@simplebuildpro/db';
import { users, refreshTokens, oauthAccounts, emailVerificationTokens, passwordResetTokens } from '@simplebuildpro/db';
import { eq, and } from 'drizzle-orm';
import { AppError } from '../middleware/error-handler';
import { requireAuth, generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../middleware/auth';
import type { AuthEnv } from '../middleware/auth';
import { rateLimiter } from '../middleware/rate-limiter';
import { sendVerificationEmail, sendPasswordResetEmail, sendWelcomeEmail } from '../services/email';

export const authRoutes = new Hono<AuthEnv>();

// Tighter rate limit on auth endpoints
authRoutes.use('*', rateLimiter('auth'));

// ─── Signup ──────────────────────────────────────────────────
const signupSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(100),
});

authRoutes.post('/signup', async (c) => {
  const body = await c.req.json();
  const { email, password, name } = signupSchema.parse(body);

  const db = getDb();

  // Check if email already exists
  const existing = await db.query.users.findFirst({
    where: eq(users.email, email.toLowerCase()),
  });

  if (existing) {
    throw new AppError(409, 'EMAIL_EXISTS', 'An account with this email already exists.');
  }

  // Hash password (bcrypt cost=12 for production)
  const passwordHash = await bcrypt.hash(password, 12);

  // Create user
  const [user] = await db.insert(users).values({
    email: email.toLowerCase(),
    name,
    passwordHash,
    plan: 'free',
  }).returning();

  // Generate tokens
  const accessToken = generateAccessToken(user);
  const refreshTokenValue = generateRefreshToken(user.id);

  // Store refresh token hash
  const tokenHash = crypto.createHash('sha256').update(refreshTokenValue).digest('hex');
  await db.insert(refreshTokens).values({
    userId: user.id,
    tokenHash,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
  });

  // Send verification email (non-blocking)
  const verificationToken = crypto.randomBytes(48).toString('hex');
  await db.insert(emailVerificationTokens).values({
    userId: user.id,
    token: verificationToken,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
  });
  sendVerificationEmail(user.email, user.name, verificationToken).catch(err => {
    console.error('[signup] Failed to send verification email:', err);
  });

  return c.json({
    success: true,
    data: {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        plan: user.plan,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt.toISOString(),
      },
      tokens: {
        accessToken,
        refreshToken: refreshTokenValue,
        expiresIn: 900, // 15 minutes in seconds
      },
    },
  }, 201);
});

// ─── Login ───────────────────────────────────────────────────
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRoutes.post('/login', async (c) => {
  const body = await c.req.json();
  const { email, password } = loginSchema.parse(body);

  const db = getDb();

  const user = await db.query.users.findFirst({
    where: eq(users.email, email.toLowerCase()),
  });

  if (!user) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  const passwordValid = await bcrypt.compare(password, user.passwordHash);
  if (!passwordValid) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  // Update last login
  await db.update(users)
    .set({ lastLoginAt: new Date() })
    .where(eq(users.id, user.id));

  // Generate tokens
  const accessToken = generateAccessToken(user);
  const refreshTokenValue = generateRefreshToken(user.id);

  const tokenHash = crypto.createHash('sha256').update(refreshTokenValue).digest('hex');
  await db.insert(refreshTokens).values({
    userId: user.id,
    tokenHash,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  return c.json({
    success: true,
    data: {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        plan: user.plan,
        avatarUrl: user.avatarUrl,
        organizationId: user.organizationId,
        createdAt: user.createdAt.toISOString(),
      },
      tokens: {
        accessToken,
        refreshToken: refreshTokenValue,
        expiresIn: 900,
      },
    },
  });
});

// ─── Refresh Token ───────────────────────────────────────────
const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

authRoutes.post('/refresh', async (c) => {
  const body = await c.req.json();
  const { refreshToken: token } = refreshSchema.parse(body);

  // Verify JWT structure
  const { userId } = verifyRefreshToken(token);

  const db = getDb();

  // Check token exists and is not revoked
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const storedToken = await db.query.refreshTokens.findFirst({
    where: and(
      eq(refreshTokens.tokenHash, tokenHash),
      eq(refreshTokens.userId, userId),
    ),
  });

  if (!storedToken || storedToken.revokedAt) {
    throw new AppError(401, 'TOKEN_REVOKED', 'Refresh token has been revoked.');
  }

  if (storedToken.expiresAt < new Date()) {
    throw new AppError(401, 'TOKEN_EXPIRED', 'Refresh token has expired.');
  }

  // Rotate: revoke old token
  await db.update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.id, storedToken.id));

  // Get fresh user data
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) {
    throw new AppError(401, 'USER_NOT_FOUND', 'User account no longer exists.');
  }

  // Issue new tokens
  const newAccessToken = generateAccessToken(user);
  const newRefreshToken = generateRefreshToken(user.id);

  const newTokenHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');
  await db.insert(refreshTokens).values({
    userId: user.id,
    tokenHash: newTokenHash,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  return c.json({
    success: true,
    data: {
      tokens: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresIn: 900,
      },
    },
  });
});

// ─── Logout ──────────────────────────────────────────────────
authRoutes.post('/logout', requireAuth, async (c) => {
  const session = c.get('session');
  const db = getDb();

  // Revoke all refresh tokens for this user
  await db.update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.userId, session.userId));

  return c.json({ success: true, data: { message: 'Logged out successfully.' } });
});

// ─── Get Current User ────────────────────────────────────────
authRoutes.get('/me', requireAuth, async (c) => {
  const session = c.get('session');
  const db = getDb();

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
  });

  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');
  }

  return c.json({
    success: true,
    data: {
      id: user.id,
      email: user.email,
      name: user.name,
      plan: user.plan,
      avatarUrl: user.avatarUrl,
      organizationId: user.organizationId,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    },
  });
});

// ─── Update Profile ──────────────────────────────────────────
const updateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  avatarUrl: z.string().url().optional().nullable(),
});

authRoutes.patch('/me', requireAuth, async (c) => {
  const session = c.get('session');
  const body = await c.req.json();
  const updates = updateProfileSchema.parse(body);

  const db = getDb();

  const [updated] = await db.update(users)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(users.id, session.userId))
    .returning();

  return c.json({
    success: true,
    data: {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      plan: updated.plan,
      avatarUrl: updated.avatarUrl,
      updatedAt: updated.updatedAt.toISOString(),
    },
  });
});

// ─── Change Password ─────────────────────────────────────────
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

authRoutes.post('/change-password', requireAuth, async (c) => {
  const session = c.get('session');
  const body = await c.req.json();
  const { currentPassword, newPassword } = changePasswordSchema.parse(body);

  const db = getDb();

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
  });

  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    throw new AppError(401, 'INVALID_PASSWORD', 'Current password is incorrect.');
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  await db.update(users)
    .set({ passwordHash: newHash, updatedAt: new Date() })
    .where(eq(users.id, session.userId));

  // Revoke all refresh tokens (force re-login)
  await db.update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.userId, session.userId));

  return c.json({ success: true, data: { message: 'Password changed. Please log in again.' } });
});

// ─── Send Verification Email ─────────────────────────────────
authRoutes.post('/send-verification', requireAuth, async (c) => {
  const session = c.get('session');
  const db = getDb();

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
  });

  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');
  }

  if (user.emailVerified) {
    return c.json({ success: true, data: { message: 'Email already verified.' } });
  }

  // Generate token
  const token = crypto.randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  await db.insert(emailVerificationTokens).values({
    userId: user.id,
    token,
    expiresAt,
  });

  await sendVerificationEmail(user.email, user.name, token);

  return c.json({ success: true, data: { message: 'Verification email sent.' } });
});

// ─── Verify Email ────────────────────────────────────────────
const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

authRoutes.post('/verify-email', async (c) => {
  const body = await c.req.json();
  const { token } = verifyEmailSchema.parse(body);

  const db = getDb();

  const record = await db.query.emailVerificationTokens.findFirst({
    where: eq(emailVerificationTokens.token, token),
  });

  if (!record) {
    throw new AppError(400, 'INVALID_TOKEN', 'Invalid or expired verification token.');
  }

  if (record.usedAt) {
    throw new AppError(400, 'TOKEN_USED', 'This verification link has already been used.');
  }

  if (new Date() > record.expiresAt) {
    throw new AppError(400, 'TOKEN_EXPIRED', 'This verification link has expired. Please request a new one.');
  }

  // Mark token as used
  await db.update(emailVerificationTokens)
    .set({ usedAt: new Date() })
    .where(eq(emailVerificationTokens.id, record.id));

  // Mark user email as verified
  await db.update(users)
    .set({ emailVerified: true, updatedAt: new Date() })
    .where(eq(users.id, record.userId));

  // Send welcome email
  const user = await db.query.users.findFirst({
    where: eq(users.id, record.userId),
  });
  if (user) {
    await sendWelcomeEmail(user.email, user.name);
  }

  return c.json({ success: true, data: { message: 'Email verified successfully.' } });
});

// ─── Forgot Password (request reset) ────────────────────────
const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

authRoutes.post('/forgot-password', async (c) => {
  const body = await c.req.json();
  const { email } = forgotPasswordSchema.parse(body);

  const db = getDb();

  const user = await db.query.users.findFirst({
    where: eq(users.email, email.toLowerCase()),
  });

  // Always return success to prevent email enumeration
  if (!user) {
    return c.json({ success: true, data: { message: 'If an account with that email exists, a reset link has been sent.' } });
  }

  // Generate reset token
  const token = crypto.randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await db.insert(passwordResetTokens).values({
    userId: user.id,
    token,
    expiresAt,
  });

  await sendPasswordResetEmail(user.email, user.name, token);

  return c.json({ success: true, data: { message: 'If an account with that email exists, a reset link has been sent.' } });
});

// ─── Reset Password (with token) ────────────────────────────
const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

authRoutes.post('/reset-password', async (c) => {
  const body = await c.req.json();
  const { token, newPassword } = resetPasswordSchema.parse(body);

  const db = getDb();

  const record = await db.query.passwordResetTokens.findFirst({
    where: eq(passwordResetTokens.token, token),
  });

  if (!record) {
    throw new AppError(400, 'INVALID_TOKEN', 'Invalid or expired reset token.');
  }

  if (record.usedAt) {
    throw new AppError(400, 'TOKEN_USED', 'This reset link has already been used.');
  }

  if (new Date() > record.expiresAt) {
    throw new AppError(400, 'TOKEN_EXPIRED', 'This reset link has expired. Please request a new one.');
  }

  // Hash new password
  const newHash = await bcrypt.hash(newPassword, 12);

  // Mark token as used
  await db.update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokens.id, record.id));

  // Update user password
  await db.update(users)
    .set({ passwordHash: newHash, updatedAt: new Date() })
    .where(eq(users.id, record.userId));

  // Revoke all refresh tokens (force re-login everywhere)
  await db.update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.userId, record.userId));

  return c.json({ success: true, data: { message: 'Password reset successfully. Please log in with your new password.' } });
});
