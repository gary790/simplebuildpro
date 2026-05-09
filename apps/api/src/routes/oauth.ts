// ============================================================
// SimpleBuild Pro — OAuth2 Routes
// Google and GitHub OAuth2 authentication flows
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import crypto from 'crypto';
import { getDb } from '@simplebuildpro/db';
import { users, oauthAccounts, refreshTokens } from '@simplebuildpro/db';
import { eq, and } from 'drizzle-orm';
import { AppError } from '../middleware/error-handler';
import { generateAccessToken, generateRefreshToken } from '../middleware/auth';
import { rateLimiter } from '../middleware/rate-limiter';

export const oauthRoutes = new Hono();

oauthRoutes.use('*', rateLimiter('auth'));

// ─── Configuration ───────────────────────────────────────────
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const API_URL = process.env.API_URL || 'http://localhost:8080';

// ─── Google OAuth2 ───────────────────────────────────────────

// Step 1: Redirect to Google
oauthRoutes.get('/google', (c) => {
  if (!GOOGLE_CLIENT_ID) {
    throw new AppError(503, 'OAUTH_NOT_CONFIGURED', 'Google OAuth is not configured.');
  }

  const state = crypto.randomBytes(32).toString('hex');
  const redirectUri = `${API_URL}/api/v1/oauth/google/callback`;

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'consent',
  });

  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// Step 2: Google callback
oauthRoutes.get('/google/callback', async (c) => {
  const code = c.req.query('code');
  const error = c.req.query('error');

  if (error || !code) {
    return c.redirect(`${APP_URL}/login?error=oauth_denied`);
  }

  try {
    const redirectUri = `${API_URL}/api/v1/oauth/google/callback`;

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = (await tokenRes.json()) as any;
    if (!tokenData.access_token) {
      return c.redirect(`${APP_URL}/login?error=oauth_token_failed`);
    }

    // Get user info
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const googleUser = (await userRes.json()) as any;

    if (!googleUser.email) {
      return c.redirect(`${APP_URL}/login?error=oauth_no_email`);
    }

    // Find or create user
    const { user, tokens } = await findOrCreateOAuthUser({
      provider: 'google',
      providerAccountId: googleUser.id,
      email: googleUser.email,
      name: googleUser.name || googleUser.email.split('@')[0],
      avatarUrl: googleUser.picture || null,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || null,
      expiresAt: tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000) : null,
    });

    // Redirect to app with tokens
    const params = new URLSearchParams({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    });
    return c.redirect(`${APP_URL}/auth/callback?${params}`);
  } catch (err: any) {
    console.error('Google OAuth error:', err);
    return c.redirect(`${APP_URL}/login?error=oauth_failed`);
  }
});

// ─── GitHub OAuth2 ───────────────────────────────────────────

// Step 1: Redirect to GitHub
oauthRoutes.get('/github', (c) => {
  if (!GITHUB_CLIENT_ID) {
    throw new AppError(503, 'OAUTH_NOT_CONFIGURED', 'GitHub OAuth is not configured.');
  }

  const state = crypto.randomBytes(32).toString('hex');
  const redirectUri = `${API_URL}/api/v1/oauth/github/callback`;

  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'user:email',
    state,
  });

  return c.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

// Step 2: GitHub callback
oauthRoutes.get('/github/callback', async (c) => {
  const code = c.req.query('code');
  const error = c.req.query('error');

  if (error || !code) {
    return c.redirect(`${APP_URL}/login?error=oauth_denied`);
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
      }),
    });

    const tokenData = (await tokenRes.json()) as any;
    if (!tokenData.access_token) {
      return c.redirect(`${APP_URL}/login?error=oauth_token_failed`);
    }

    // Get user info
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'SimpleBuildPro',
      },
    });
    const ghUser = (await userRes.json()) as any;

    // Get primary email if not public
    let email = ghUser.email;
    if (!email) {
      const emailsRes = await fetch('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'SimpleBuildPro',
        },
      });
      const emails = (await emailsRes.json()) as any[];
      const primary = emails.find((e: any) => e.primary && e.verified);
      email = primary?.email || emails[0]?.email;
    }

    if (!email) {
      return c.redirect(`${APP_URL}/login?error=oauth_no_email`);
    }

    // Find or create user
    const { user, tokens } = await findOrCreateOAuthUser({
      provider: 'github',
      providerAccountId: String(ghUser.id),
      email,
      name: ghUser.name || ghUser.login,
      avatarUrl: ghUser.avatar_url || null,
      accessToken: tokenData.access_token,
      refreshToken: null,
      expiresAt: null,
    });

    // Redirect to app with tokens
    const params = new URLSearchParams({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    });
    return c.redirect(`${APP_URL}/auth/callback?${params}`);
  } catch (err: any) {
    console.error('GitHub OAuth error:', err);
    return c.redirect(`${APP_URL}/login?error=oauth_failed`);
  }
});

// ─── Shared: Find or create OAuth user ───────────────────────
interface OAuthUserData {
  provider: string;
  providerAccountId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
}

async function findOrCreateOAuthUser(data: OAuthUserData) {
  const db = getDb();

  // Check if OAuth account already linked
  const existingOAuth = await db.query.oauthAccounts.findFirst({
    where: and(
      eq(oauthAccounts.provider, data.provider),
      eq(oauthAccounts.providerAccountId, data.providerAccountId),
    ),
  });

  let user;

  if (existingOAuth) {
    // Existing OAuth link — update tokens and get user
    await db
      .update(oauthAccounts)
      .set({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: data.expiresAt,
      })
      .where(eq(oauthAccounts.id, existingOAuth.id));

    user = await db.query.users.findFirst({
      where: eq(users.id, existingOAuth.userId),
    });
  } else {
    // Check if user exists by email
    user = await db.query.users.findFirst({
      where: eq(users.email, data.email.toLowerCase()),
    });

    if (user) {
      // Link OAuth to existing user
      await db.insert(oauthAccounts).values({
        userId: user.id,
        provider: data.provider,
        providerAccountId: data.providerAccountId,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: data.expiresAt,
      });
    } else {
      // Create new user + OAuth link
      const randomPassword = crypto.randomBytes(32).toString('hex');
      const bcrypt = await import('bcryptjs');
      const passwordHash = await bcrypt.hash(randomPassword, 12);

      const [newUser] = await db
        .insert(users)
        .values({
          email: data.email.toLowerCase(),
          name: data.name,
          passwordHash,
          avatarUrl: data.avatarUrl,
          plan: 'free',
          emailVerified: true, // OAuth emails are pre-verified
        })
        .returning();

      user = newUser;

      await db.insert(oauthAccounts).values({
        userId: user.id,
        provider: data.provider,
        providerAccountId: data.providerAccountId,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: data.expiresAt,
      });
    }
  }

  if (!user) {
    throw new AppError(500, 'OAUTH_ERROR', 'Failed to create or find user.');
  }

  // Update last login
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

  // Generate tokens
  const accessToken = generateAccessToken(user);
  const refreshTokenValue = generateRefreshToken(user.id);

  const tokenHash = crypto.createHash('sha256').update(refreshTokenValue).digest('hex');
  await db.insert(refreshTokens).values({
    userId: user.id,
    tokenHash,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  return {
    user,
    tokens: {
      accessToken,
      refreshToken: refreshTokenValue,
      expiresIn: 900,
    },
  };
}
