// ============================================================
// SimpleBuild Pro — Email Service (Resend)
// Handles transactional emails: verification, password reset,
// welcome, billing alerts
// ============================================================

import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = 'SimpleBuild Pro <noreply@simplebuildpro.com>';
const APP_URL = process.env.APP_URL || 'https://app.simplebuildpro.com';

// ─── Email Templates ─────────────────────────────────────────

function verificationEmailHtml(name: string, token: string): string {
  const verifyUrl = `${APP_URL}/verify-email?token=${token}`;
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="color: #111; font-size: 24px; margin: 0;">SimpleBuild Pro</h1>
  </div>
  <h2 style="color: #111; font-size: 20px;">Verify your email address</h2>
  <p style="color: #555; font-size: 16px; line-height: 1.6;">
    Hi ${name},<br><br>
    Thanks for signing up! Please verify your email address by clicking the button below.
  </p>
  <div style="text-align: center; margin: 32px 0;">
    <a href="${verifyUrl}" style="background-color: #2563eb; color: white; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 16px;">
      Verify Email
    </a>
  </div>
  <p style="color: #888; font-size: 14px;">
    Or copy this link: <a href="${verifyUrl}" style="color: #2563eb;">${verifyUrl}</a>
  </p>
  <p style="color: #888; font-size: 14px;">This link expires in 24 hours.</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;">
  <p style="color: #aaa; font-size: 12px; text-align: center;">
    SimpleBuild Pro · Build websites with AI<br>
    If you didn't create this account, you can ignore this email.
  </p>
</body>
</html>`;
}

function passwordResetEmailHtml(name: string, token: string): string {
  const resetUrl = `${APP_URL}/reset-password?token=${token}`;
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="color: #111; font-size: 24px; margin: 0;">SimpleBuild Pro</h1>
  </div>
  <h2 style="color: #111; font-size: 20px;">Reset your password</h2>
  <p style="color: #555; font-size: 16px; line-height: 1.6;">
    Hi ${name},<br><br>
    We received a request to reset your password. Click the button below to choose a new one.
  </p>
  <div style="text-align: center; margin: 32px 0;">
    <a href="${resetUrl}" style="background-color: #2563eb; color: white; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 16px;">
      Reset Password
    </a>
  </div>
  <p style="color: #888; font-size: 14px;">
    Or copy this link: <a href="${resetUrl}" style="color: #2563eb;">${resetUrl}</a>
  </p>
  <p style="color: #888; font-size: 14px;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;">
  <p style="color: #aaa; font-size: 12px; text-align: center;">
    SimpleBuild Pro · Build websites with AI
  </p>
</body>
</html>`;
}

function welcomeEmailHtml(name: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="color: #111; font-size: 24px; margin: 0;">SimpleBuild Pro</h1>
  </div>
  <h2 style="color: #111; font-size: 20px;">Welcome to SimpleBuild Pro! 🎉</h2>
  <p style="color: #555; font-size: 16px; line-height: 1.6;">
    Hi ${name},<br><br>
    Your email is verified and your account is ready. Here's what you can do:
  </p>
  <ul style="color: #555; font-size: 16px; line-height: 2;">
    <li><strong>Create a project</strong> — start building your website with AI assistance</li>
    <li><strong>Chat with AI</strong> — describe what you want and watch it come to life</li>
    <li><strong>Deploy instantly</strong> — publish to a live URL with one click</li>
    <li><strong>Custom domains</strong> — connect your own domain (pay-as-you-go)</li>
  </ul>
  <div style="text-align: center; margin: 32px 0;">
    <a href="${APP_URL}/dashboard" style="background-color: #2563eb; color: white; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 16px;">
      Go to Dashboard
    </a>
  </div>
  <p style="color: #888; font-size: 14px;">
    <strong>Free tier includes:</strong> 10 AI messages/day, 3 deploys/day, 50 MB storage, 2 projects.
    Need more? Pay only for what you use — no subscriptions required.
  </p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;">
  <p style="color: #aaa; font-size: 12px; text-align: center;">
    SimpleBuild Pro · Build websites with AI
  </p>
</body>
</html>`;
}

function spendAlertEmailHtml(name: string, spendToday: string, limit: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="color: #111; font-size: 24px; margin: 0;">SimpleBuild Pro</h1>
  </div>
  <h2 style="color: #dc2626; font-size: 20px;">⚠️ Spending Alert</h2>
  <p style="color: #555; font-size: 16px; line-height: 1.6;">
    Hi ${name},<br><br>
    Your spending today has reached <strong>$${spendToday}</strong> (daily limit: $${limit}).
  </p>
  <p style="color: #555; font-size: 16px; line-height: 1.6;">
    If this is unexpected, you can adjust your daily spend limit in your account settings.
  </p>
  <div style="text-align: center; margin: 32px 0;">
    <a href="${APP_URL}/dashboard/settings" style="background-color: #dc2626; color: white; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 16px;">
      Review Spending
    </a>
  </div>
  <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;">
  <p style="color: #aaa; font-size: 12px; text-align: center;">
    SimpleBuild Pro · Build websites with AI
  </p>
</body>
</html>`;
}

// ─── Send Functions ──────────────────────────────────────────

export async function sendVerificationEmail(email: string, name: string, token: string): Promise<void> {
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: 'Verify your email — SimpleBuild Pro',
      html: verificationEmailHtml(name, token),
    });
    console.log(`[email] Verification email sent to ${email}`);
  } catch (error) {
    console.error(`[email] Failed to send verification email to ${email}:`, error);
    throw error;
  }
}

export async function sendPasswordResetEmail(email: string, name: string, token: string): Promise<void> {
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: 'Reset your password — SimpleBuild Pro',
      html: passwordResetEmailHtml(name, token),
    });
    console.log(`[email] Password reset email sent to ${email}`);
  } catch (error) {
    console.error(`[email] Failed to send password reset email to ${email}:`, error);
    throw error;
  }
}

export async function sendWelcomeEmail(email: string, name: string): Promise<void> {
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: 'Welcome to SimpleBuild Pro! 🎉',
      html: welcomeEmailHtml(name),
    });
    console.log(`[email] Welcome email sent to ${email}`);
  } catch (error) {
    console.error(`[email] Failed to send welcome email to ${email}:`, error);
    // Non-critical — don't throw
  }
}

export async function sendSpendAlertEmail(email: string, name: string, spendToday: string, limit: string): Promise<void> {
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: '⚠️ Spending alert — SimpleBuild Pro',
      html: spendAlertEmailHtml(name, spendToday, limit),
    });
    console.log(`[email] Spend alert sent to ${email}`);
  } catch (error) {
    console.error(`[email] Failed to send spend alert to ${email}:`, error);
  }
}
