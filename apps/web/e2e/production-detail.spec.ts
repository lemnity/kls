import { test, expect } from '@playwright/test';

/**
 * E2E coverage for the production detail page's budget view.
 *
 * Relies on the same E2E_MOCK_PRODUCTIONS=1 server-side fixture hook as
 * dashboard.spec.ts (see apps/web/app/lib/mock-data.ts for the fixtures).
 */

const SESSION_COOKIE = {
  name: 'kulisa_session',
  value: 'e2e-fake-token',
  domain: 'localhost',
  path: '/',
} as const;

test.describe('production detail budget view', () => {
  test('shows a preliminary budget as a per-section summary and supports the workshop filter', async ({
    page,
    context,
  }) => {
    await context.addCookies([SESSION_COOKIE]);
    await page.goto('/productions/prod-1');

    await expect(page.getByTestId('budget-status')).toHaveAttribute('data-budget-status', 'PRELIMINARY');
    await expect(page.getByTestId('budget-section')).toHaveCount(2);
    await expect(page.locator('.budget-items-table')).toHaveCount(0);

    const filter = page.getByTestId('budget-workshop-filter');
    await expect(filter).toBeVisible();
    await filter.selectOption('workshop-2');

    await expect(page.getByTestId('budget-section')).toHaveCount(1);
    await expect(page.getByTestId('budget-section')).toContainText('Бутафорский цех');
  });

  test('shows an approved budget as a locked, full item breakdown', async ({ page, context }) => {
    await context.addCookies([SESSION_COOKIE]);
    await page.goto('/productions/prod-2');

    await expect(page.getByTestId('budget-status')).toHaveAttribute('data-budget-status', 'APPROVED');
    await expect(page.locator('.budget-items-table')).toBeVisible();
    await expect(page.getByText('Смета утверждена и больше не редактируется.')).toBeVisible();
  });
});
