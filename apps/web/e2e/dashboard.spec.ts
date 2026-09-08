import { test, expect } from '@playwright/test';

/**
 * E2E coverage for the auth gate + dashboard shell.
 *
 * These tests rely on two server-side test hooks that the dashboard/login
 * code is expected to honor (see apps/web/playwright.config.ts):
 *   - E2E_MOCK_PRODUCTIONS=1 (set on the dev server via webServer.env):
 *     the dashboard's server-side data fetch returns fixture productions
 *     instead of calling the real NestJS API.
 *   - a `kulisa_session=e2e-fake-token` cookie: the dashboard's session
 *     check is expected to treat this as an authenticated session without
 *     making a real request.
 *
 * The login form itself talks to POST /api/session from the browser, so
 * that request is intercepted directly with page.route().
 */

const SESSION_COOKIE = {
  name: 'kulisa_session',
  value: 'e2e-fake-token',
  domain: 'localhost',
  path: '/',
} as const;

test.describe('dashboard auth gate', () => {
  test('redirects unauthenticated users to /login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });

  test('shows the productions list for an authenticated user', async ({ page, context }) => {
    await context.addCookies([SESSION_COOKIE]);

    await page.goto('/');

    const list = page.getByTestId('productions-list');
    await expect(list).toBeVisible();

    const cards = page.getByTestId('production-card');
    await expect(cards).toHaveCount(2);

    const firstCard = cards.first();
    await expect(firstCard).toContainText('Ревизор');
    await expect(firstCard.getByTestId('production-health')).toHaveAttribute(
      'data-health',
      'neutral',
    );
  });
});

test.describe('login form', () => {
  test('navigates away from /login on a successful submit', async ({ page }) => {
    await page.route('**/api/session', async (route) => {
      await route.fulfill({ status: 200, json: { status: 'ok' } });
    });

    await page.goto('/login');
    await page.getByTestId('email-input').fill('director@kulisa.test');
    await page.getByTestId('password-input').fill('correct-horse-battery-staple');

    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith('/login')),
      page.getByTestId('login-submit').click(),
    ]);

    // Note: the mocked /api/session response does not set a real cookie in
    // the browser, so the dashboard will itself redirect back to /login
    // once it re-checks the session. We only assert that the submit
    // triggered a navigation away from /login here, not the final
    // destination's content.
  });

  test('shows an error and stays on /login when credentials are rejected', async ({ page }) => {
    await page.route('**/api/session', async (route) => {
      await route.fulfill({ status: 401, json: { error: 'invalid_credentials' } });
    });

    await page.goto('/login');
    await page.getByTestId('email-input').fill('director@kulisa.test');
    await page.getByTestId('password-input').fill('wrong-password');
    await page.getByTestId('login-submit').click();

    const error = page.getByTestId('login-error');
    await expect(error).toBeVisible();
    await expect(error).toHaveAttribute('role', 'alert');
    await expect(page).toHaveURL(/\/login/);
  });
});
