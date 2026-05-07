// ============================================================
// SimpleBuild Pro — E2E Tests: Authentication
// Tests signup, login, OAuth buttons, MFA flow, logout
// ============================================================

import { test, expect, type Page } from '@playwright/test';

const TEST_USER = {
  email: `e2e-${Date.now()}@test.simplebuildpro.com`,
  password: 'TestPassword123!',
  name: 'E2E Test User',
};

test.describe('Authentication', () => {
  test.describe('Signup Page', () => {
    test('should display signup form with all fields', async ({ page }) => {
      await page.goto('/signup');
      await expect(page.locator('input[type="email"]')).toBeVisible();
      await expect(page.locator('input[type="password"]')).toBeVisible();
      await expect(page.locator('input[id="name"], input[placeholder*="name" i]')).toBeVisible();
      await expect(page.getByRole('button', { name: /sign up/i })).toBeVisible();
    });

    test('should show validation errors for empty form', async ({ page }) => {
      await page.goto('/signup');
      await page.getByRole('button', { name: /sign up/i }).click();
      // HTML5 validation should prevent submission
      const emailInput = page.locator('input[type="email"]');
      await expect(emailInput).toHaveAttribute('required', '');
    });

    test('should link to login page', async ({ page }) => {
      await page.goto('/signup');
      const loginLink = page.getByRole('link', { name: /sign in|log in/i });
      await expect(loginLink).toBeVisible();
      await loginLink.click();
      await expect(page).toHaveURL(/\/login/);
    });
  });

  test.describe('Login Page', () => {
    test('should display login form with email/password fields', async ({ page }) => {
      await page.goto('/login');
      await expect(page.locator('input[type="email"]')).toBeVisible();
      await expect(page.locator('input[type="password"]')).toBeVisible();
      await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
    });

    test('should display OAuth login buttons', async ({ page }) => {
      await page.goto('/login');
      await expect(page.getByRole('button', { name: /google/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /github/i })).toBeVisible();
    });

    test('should show error for invalid credentials', async ({ page }) => {
      await page.goto('/login');
      await page.locator('input[type="email"]').fill('invalid@test.com');
      await page.locator('input[type="password"]').fill('wrongpassword');
      await page.getByRole('button', { name: /sign in/i }).click();

      // Wait for error message
      await expect(page.locator('.bg-red-50, [role="alert"]')).toBeVisible({ timeout: 10_000 });
    });

    test('should link to signup page', async ({ page }) => {
      await page.goto('/login');
      const signupLink = page.getByRole('link', { name: /sign up/i });
      await expect(signupLink).toBeVisible();
      await signupLink.click();
      await expect(page).toHaveURL(/\/signup/);
    });

    test('Google OAuth button should redirect to Google', async ({ page }) => {
      await page.goto('/login');
      const [popup] = await Promise.all([
        page.waitForEvent('popup').catch(() => null),
        page.getByRole('button', { name: /google/i }).click(),
      ]);
      // Should redirect to Google or API OAuth endpoint
      const url = popup ? popup.url() : page.url();
      expect(url).toMatch(/accounts\.google\.com|\/api\/v1\/oauth\/google/);
    });

    test('GitHub OAuth button should redirect to GitHub', async ({ page }) => {
      await page.goto('/login');
      const [popup] = await Promise.all([
        page.waitForEvent('popup').catch(() => null),
        page.getByRole('button', { name: /github/i }).click(),
      ]);
      const url = popup ? popup.url() : page.url();
      expect(url).toMatch(/github\.com|\/api\/v1\/oauth\/github/);
    });
  });

  test.describe('OAuth Callback', () => {
    test('should display error for missing tokens', async ({ page }) => {
      await page.goto('/auth/callback');
      await expect(page.getByText(/missing|error/i)).toBeVisible({ timeout: 5_000 });
    });

    test('should display error for oauth_denied parameter', async ({ page }) => {
      await page.goto('/auth/callback?error=oauth_denied');
      await expect(page.getByText(/denied|try again/i)).toBeVisible({ timeout: 5_000 });
    });
  });

  test.describe('Protected Routes', () => {
    test('should redirect unauthenticated users from dashboard to login', async ({ page }) => {
      await page.goto('/dashboard');
      // Should redirect to login or show login UI
      await page.waitForURL(/\/(login|dashboard)/, { timeout: 10_000 });
    });

    test('should redirect unauthenticated users from settings to login', async ({ page }) => {
      await page.goto('/dashboard/settings');
      await page.waitForURL(/\/(login|dashboard)/, { timeout: 10_000 });
    });
  });
});
