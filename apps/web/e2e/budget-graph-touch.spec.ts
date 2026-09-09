import { test, expect } from '@playwright/test';

/**
 * Touch/tablet coverage for the visual budget constructor's canvas
 * (Инкремент 8 acceptance: "конструктор работает пальцем на планшете").
 *
 * Same E2E_MOCK_PRODUCTIONS server-side fixture hook as dashboard.spec.ts /
 * production-detail.spec.ts (see apps/web/app/productions/[id]/budget-graph/page.tsx)
 * covers the server component's data fetch. The editor itself is a client
 * component that calls /api/proxy/*, so those calls are intercepted here
 * with page.route() — there is no real backend in this test run.
 *
 * Note: this runs at an iPad-sized viewport with hasTouch explicitly
 * enabled on the browser context (kept on the project's own chromium
 * engine, rather than pulling in devices['iPad Pro']'s default of webkit,
 * which this repo's single Playwright project isn't set up for), so
 * layout/interaction is exercised with touch support available and
 * page.touchscreen/`.tap()` work for the tap gestures. The drag gesture
 * below still goes through page.mouse — React Flow's drag handling is
 * built on pointer events, which Chromium dispatches for mouse input the
 * same way inside a touch-enabled context, so this exercises the same
 * code path without asserting on literal `touchstart`/`touchmove` events.
 */

test.use({
  viewport: { width: 1024, height: 1366 },
  hasTouch: true,
  isMobile: false,
});

const SESSION_COOKIE = {
  name: 'kulisa_session',
  value: 'e2e-fake-token',
  domain: 'localhost',
  path: '/',
} as const;

const ROOT_NODE = {
  id: 'node-root',
  budgetVersionId: 'version-1',
  parentId: null,
  workshopId: null,
  nodeType: 'production',
  title: 'Ревизор',
  plannedAmount: '0.00',
  subtreeTotal: '0.00',
  approvedTotal: null,
  positionX: '40.00',
  positionY: '40.00',
  width: '180.00',
  height: '90.00',
  alternativeGroupId: null,
  isActive: true,
  revision: 1,
};

const WORKSHOP_NODE = {
  ...ROOT_NODE,
  id: 'node-workshop',
  parentId: 'node-root',
  workshopId: null,
  nodeType: 'workshop',
  title: 'Пошивочный цех',
  positionX: '340.00',
  positionY: '40.00',
};

test.describe('budget graph canvas on a tablet', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.addCookies([SESSION_COOKIE]);

    let nodes = [ROOT_NODE, WORKSHOP_NODE];

    await page.route('**/api/proxy/budget-versions/**/graph-nodes', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, json: nodes });
        return;
      }
      await route.continue();
    });
    await page.route('**/api/proxy/organization/memberships', async (route) => {
      await route.fulfill({ status: 200, json: [] });
    });
    await page.route('**/api/proxy/organization/workshops', async (route) => {
      await route.fulfill({ status: 200, json: [] });
    });
    await page.route('**/api/proxy/budget-templates', async (route) => {
      await route.fulfill({ status: 200, json: [] });
    });
    await page.route('**/api/proxy/budget-graph-nodes/*/tasks', async (route) => {
      await route.fulfill({ status: 200, json: [] });
    });
    await page.route('**/api/proxy/budget-graph-nodes/*/attachments', async (route) => {
      await route.fulfill({ status: 200, json: [] });
    });
    await page.route('**/api/proxy/budget-graph-nodes/*/layout', async (route) => {
      const body = route.request().postDataJSON() as { positionX: string; positionY: string; width: string; height: string };
      const updated = { ...WORKSHOP_NODE, ...body, revision: WORKSHOP_NODE.revision + 1 };
      nodes = nodes.map((node) => (node.id === WORKSHOP_NODE.id ? updated : node));
      await route.fulfill({ status: 200, json: updated });
    });
  });

  test('a tap opens the side panel for a node', async ({ page }) => {
    await page.goto('/productions/prod-1/budget-graph');
    await expect(page.getByTestId('budget-graph-canvas')).toBeVisible();

    const workshopCard = page.locator('.graph-node', { hasText: 'Пошивочный цех' });
    await expect(workshopCard).toBeVisible();

    const box = await workshopCard.boundingBox();
    if (!box) throw new Error('workshop card has no bounding box');
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);

    const panel = page.locator('.budget-graph__side-panel');
    await expect(panel).toBeVisible();
    // The title shows as an editable input's value, not text content.
    await expect(panel.locator('input[type="text"]').first()).toHaveValue('Пошивочный цех');
  });

  test('dragging a node on the canvas persists its new position', async ({ page }) => {
    await page.goto('/productions/prod-1/budget-graph');
    // Let React Flow finish measuring the custom node before dragging it —
    // dragging too early logs its "node that is not initialized" warning
    // and the drag doesn't take effect.
    await expect(page.locator('.graph-node', { hasText: 'Пошивочный цех' })).toBeVisible();
    await page.waitForTimeout(500);

    const workshopCard = page.locator('.graph-node', { hasText: 'Пошивочный цех' });
    const before = await workshopCard.boundingBox();
    if (!before) throw new Error('workshop card has no bounding box');

    const startX = before.x + before.width / 2;
    const startY = before.y + 15;

    const layoutRequestPromise = page
      .waitForRequest((request) => request.url().includes('/layout') && request.method() === 'PATCH', { timeout: 5000 })
      .catch(() => null);

    await page.mouse.move(startX, startY);
    await page.waitForTimeout(150); // let :hover settle, matching the live-verified drag pattern
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(startX + i * 15, startY + i * 10, { steps: 2 });
      await page.waitForTimeout(20);
    }
    await page.mouse.up();

    const layoutRequest = await layoutRequestPromise;
    await page.waitForTimeout(300);
    const after = await workshopCard.boundingBox();
    if (!after) throw new Error('workshop card lost its bounding box after drag');

    expect(after.x).not.toBeCloseTo(before.x, 0);
    expect(layoutRequest).not.toBeNull();
  });

  test('creating a node from the toolbar form works at tablet width', async ({ page }) => {
    let created: unknown = null;
    await page.route('**/api/proxy/budget-versions/**/graph-nodes', async (route) => {
      if (route.request().method() === 'POST') {
        created = route.request().postDataJSON();
        await route.fulfill({
          status: 201,
          json: { ...ROOT_NODE, id: 'node-new', parentId: 'node-root', nodeType: 'workshop', title: 'Новый цех' },
        });
        return;
      }
      await route.fulfill({ status: 200, json: [ROOT_NODE, WORKSHOP_NODE] });
    });

    await page.goto('/productions/prod-1/budget-graph');
    const toolbar = page.locator('.budget-graph__create-form');
    await toolbar.locator('select').first().selectOption({ label: 'Спектакль: Ревизор' });
    await toolbar.getByPlaceholder('Название').fill('Новый цех');
    await toolbar.getByPlaceholder('0.00').fill('100.00');
    await toolbar.getByRole('button', { name: 'Добавить узел' }).tap();

    await expect.poll(() => created).not.toBeNull();
  });
});
