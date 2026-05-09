// ============================================================
// SimpleBuild Pro — Auth Middleware
// JWT verification + session injection
// ============================================================

import type { MiddlewareHandler } from 'hono';
import jwt from 'jsonwebtoken';
import { getDb } from '@simplebuildpro/db';
import { users } from '@simplebuildpro/db';
import { eq } from 'drizzle-orm';
import { AppError } from './error-handler';
import type { Session } from '@simplebuildpro/shared';

const JWT_SECRET = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is required');
  return secret;
};

export interface AuthEnv {
  Variables: {
    session: Session;
    userId: string;
  };
}

// Require authentication — rejects with 401 if no valid token
export const requireAuth: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError(401, 'UNAUTHORIZED', 'Authentication required. Provide a Bearer token.');
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, JWT_SECRET()) as {
      sub: string;
      email: string;
      name: string;
      plan: string;
      orgId: string | null;
    };

    const session: Session = {
      userId: payload.sub,
      email: payload.email,
      name: payload.name,
      plan: payload.plan as Session['plan'],
      organizationId: payload.orgId,
    };

    c.set('session', session);
    c.set('userId', payload.sub);

    await next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError(401, 'TOKEN_EXPIRED', 'Access token has expired. Please refresh.');
    }
    if (err instanceof jwt.JsonWebTokenError) {
      throw new AppError(401, 'INVALID_TOKEN', 'Invalid access token.');
    }
    throw err;
  }
};

// Optional authentication — sets session if token present, continues either way
export const optionalAuth: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (authHeader?.startsWith('Bearer ')) {
    try {
      const token = authHeader.slice(7);
      const payload = jwt.verify(token, JWT_SECRET()) as {
        sub: string;
        email: string;
        name: string;
        plan: string;
        orgId: string | null;
      };

      c.set('session', {
        userId: payload.sub,
        email: payload.email,
        name: payload.name,
        plan: payload.plan as Session['plan'],
        organizationId: payload.orgId,
      });
      c.set('userId', payload.sub);
    } catch {
      // Invalid token — continue without auth
    }
  }

  await next();
};

// Generate JWT access token (short-lived: 15 minutes)
export function generateAccessToken(user: {
  id: string;
  email: string;
  name: string;
  plan: string;
  organizationId: string | null;
}): string {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
      plan: user.plan,
      orgId: user.organizationId,
    },
    JWT_SECRET(),
    { expiresIn: '15m', issuer: 'simplebuildpro.com' },
  );
}

// Generate refresh token (long-lived: 30 days)
export function generateRefreshToken(userId: string): string {
  return jwt.sign({ sub: userId, type: 'refresh' }, JWT_SECRET(), {
    expiresIn: '30d',
    issuer: 'simplebuildpro.com',
  });
}

// Verify refresh token
export function verifyRefreshToken(token: string): { userId: string } {
  try {
    const payload = jwt.verify(token, JWT_SECRET()) as { sub: string; type: string };
    if (payload.type !== 'refresh') {
      throw new AppError(401, 'INVALID_TOKEN', 'Not a refresh token.');
    }
    return { userId: payload.sub };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(401, 'INVALID_TOKEN', 'Invalid or expired refresh token.');
  }
}
