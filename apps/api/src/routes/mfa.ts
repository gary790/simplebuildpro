// ============================================================
// SimpleBuild Pro — MFA/2FA Routes
// TOTP-based multi-factor authentication
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import crypto from 'crypto';
import { getDb } from '@simplebuildpro/db';
import { users } from '@simplebuildpro/db';
import { eq } from 'drizzle-orm';
import { AppError } from '../middleware/error-handler';
import { requireAuth } from '../middleware/auth';
import type { AuthEnv } from '../middleware/auth';
import { rateLimiter } from '../middleware/rate-limiter';

export const mfaRoutes = new Hono<AuthEnv>();

mfaRoutes.use('*', requireAuth);
mfaRoutes.use('*', rateLimiter('auth'));

// ─── TOTP Helpers ────────────────────────────────────────────

// Generate a base32 secret (RFC 4648)
function generateSecret(length = 20): string {
  const bytes = crypto.randomBytes(length);
  const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    result += base32Chars[bytes[i] % 32];
  }
  return result;
}

// Decode base32 to buffer
function base32Decode(encoded: string): Buffer {
  const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = encoded.replace(/[^A-Z2-7]/gi, '').toUpperCase();
  let bits = '';
  for (const char of cleaned) {
    const val = base32Chars.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

// Generate TOTP code for a given time
function generateTOTP(secret: string, timeStep = 30, digits = 6, time?: number): string {
  const now = time || Math.floor(Date.now() / 1000);
  const counter = Math.floor(now / timeStep);

  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const key = base32Decode(secret);
  const hmac = crypto.createHmac('sha1', key).update(counterBuffer).digest();

  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    (((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff)) %
    Math.pow(10, digits);

  return code.toString().padStart(digits, '0');
}

// Verify TOTP with window tolerance
function verifyTOTP(secret: string, token: string, window = 1): boolean {
  const now = Math.floor(Date.now() / 1000);
  for (let i = -window; i <= window; i++) {
    const testTime = now + i * 30;
    if (generateTOTP(secret, 30, 6, testTime) === token) {
      return true;
    }
  }
  return false;
}

// Generate recovery codes
function generateRecoveryCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    codes.push(`${code.slice(0, 4)}-${code.slice(4)}`);
  }
  return codes;
}

// ─── Setup MFA (Step 1: Generate Secret) ─────────────────────
mfaRoutes.post('/setup', async (c) => {
  const session = c.get('session');
  const db = getDb();

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
  });

  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');

  // Check if MFA already enabled
  if ((user as any).totpEnabled) {
    throw new AppError(400, 'MFA_ALREADY_ENABLED', 'MFA is already enabled on this account.');
  }

  // Generate new secret
  const secret = generateSecret();

  // Store secret temporarily (not yet enabled)
  await db
    .update(users)
    .set({ totpSecret: secret } as any)
    .where(eq(users.id, session.userId));

  // Build otpauth URI for QR code
  const issuer = 'SimpleBuildPro';
  const otpauthUrl = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(user.email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

  return c.json({
    success: true,
    data: {
      secret,
      otpauthUrl,
      qrCodeUrl: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(otpauthUrl)}`,
    },
  });
});

// ─── Verify & Enable MFA (Step 2) ───────────────────────────
const verifySetupSchema = z.object({
  token: z
    .string()
    .length(6)
    .regex(/^\d{6}$/),
});

mfaRoutes.post('/verify-setup', async (c) => {
  const session = c.get('session');
  const body = await c.req.json();
  const { token } = verifySetupSchema.parse(body);

  const db = getDb();

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
  });

  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');

  const secret = (user as any).totpSecret;
  if (!secret) {
    throw new AppError(400, 'NO_MFA_SETUP', 'Call /mfa/setup first to generate a secret.');
  }

  // Verify the TOTP token
  if (!verifyTOTP(secret, token)) {
    throw new AppError(401, 'INVALID_TOKEN', 'Invalid verification code. Please try again.');
  }

  // Generate recovery codes
  const recoveryCodes = generateRecoveryCodes();
  const hashedCodes = recoveryCodes.map((code) =>
    crypto.createHash('sha256').update(code).digest('hex'),
  );

  // Enable MFA
  await db
    .update(users)
    .set({
      totpEnabled: true,
      mfaRecoveryCodes: JSON.stringify(hashedCodes),
      updatedAt: new Date(),
    } as any)
    .where(eq(users.id, session.userId));

  return c.json({
    success: true,
    data: {
      enabled: true,
      recoveryCodes,
      message: 'MFA enabled. Save your recovery codes in a safe place.',
    },
  });
});

// ─── Verify MFA Token (during login) ────────────────────────
const verifyTokenSchema = z.object({
  token: z.string().min(1),
  userId: z.string().uuid(),
});

mfaRoutes.post('/verify', async (c) => {
  // This endpoint doesn't require auth (used during login flow)
  const body = await c.req.json();
  const { token, userId } = verifyTokenSchema.parse(body);

  const db = getDb();

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user || !(user as any).totpEnabled) {
    throw new AppError(400, 'MFA_NOT_ENABLED', 'MFA is not enabled for this account.');
  }

  const secret = (user as any).totpSecret;

  // Check if it's a TOTP code (6 digits)
  if (/^\d{6}$/.test(token)) {
    if (!verifyTOTP(secret, token)) {
      throw new AppError(401, 'INVALID_TOKEN', 'Invalid MFA code.');
    }
    return c.json({ success: true, data: { verified: true } });
  }

  // Check if it's a recovery code (XXXX-XXXX format)
  const normalizedToken = token.toUpperCase().replace(/\s/g, '');
  const tokenHash = crypto.createHash('sha256').update(normalizedToken).digest('hex');
  const recoveryCodes: string[] = JSON.parse((user as any).mfaRecoveryCodes || '[]');

  const codeIndex = recoveryCodes.indexOf(tokenHash);
  if (codeIndex === -1) {
    throw new AppError(401, 'INVALID_TOKEN', 'Invalid MFA code or recovery code.');
  }

  // Remove used recovery code
  recoveryCodes.splice(codeIndex, 1);
  await db
    .update(users)
    .set({ mfaRecoveryCodes: JSON.stringify(recoveryCodes) } as any)
    .where(eq(users.id, userId));

  return c.json({
    success: true,
    data: {
      verified: true,
      recoveryCodesRemaining: recoveryCodes.length,
    },
  });
});

// ─── Disable MFA ─────────────────────────────────────────────
const disableSchema = z.object({
  password: z.string().min(1),
});

mfaRoutes.post('/disable', async (c) => {
  const session = c.get('session');
  const body = await c.req.json();
  const { password } = disableSchema.parse(body);

  const db = getDb();

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
  });

  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');

  // Verify password
  const bcrypt = await import('bcryptjs');
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw new AppError(401, 'INVALID_PASSWORD', 'Incorrect password.');
  }

  // Disable MFA
  await db
    .update(users)
    .set({
      totpEnabled: false,
      totpSecret: null,
      mfaRecoveryCodes: JSON.stringify([]),
      updatedAt: new Date(),
    } as any)
    .where(eq(users.id, session.userId));

  return c.json({ success: true, data: { enabled: false, message: 'MFA disabled.' } });
});

// ─── MFA Status ──────────────────────────────────────────────
mfaRoutes.get('/status', async (c) => {
  const session = c.get('session');
  const db = getDb();

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
  });

  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');

  const recoveryCodes: string[] = JSON.parse((user as any).mfaRecoveryCodes || '[]');

  return c.json({
    success: true,
    data: {
      enabled: (user as any).totpEnabled || false,
      recoveryCodesRemaining: recoveryCodes.length,
    },
  });
});
