// tests/visual/pages.spec.ts — paste into project
import { test, expect } from '@playwright/test';

// Edit routes per project
const ROUTES = ['/', '/dashboard', '/settings'];

for (const route of ROUTES) {
  test(`${route} matches baseline`, async ({ page }, info) => {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot(
      `${route.replaceAll('/', '_') || 'home'}--${info.project.name}.png`,
      {
        fullPage: true,
        // Mask anything time-based, animated, or data-volatile
        mask: [
          page.locator('[data-testid="timestamp"]'),
          page.locator('[data-testid="relative-time"]'),
          page.locator('video'),
          page.locator('[data-testid="live-counter"]'),
        ],
      },
    );
  });
}
