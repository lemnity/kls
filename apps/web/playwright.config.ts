import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E config for apps/web.
 *
 * These tests run against a Next.js dev server started for the test run.
 * They do NOT talk to the real NestJS API / Postgres — the dashboard's
 * server-side data fetch is expected to short-circuit to fixture data when
 * E2E_MOCK_PRODUCTIONS=1 is set (see the dashboard page implementation).
 * Browser-side calls (the login form's POST /api/session) are intercepted
 * per-test via page.route().
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      E2E_MOCK_PRODUCTIONS: '1',
    },
  },
});
