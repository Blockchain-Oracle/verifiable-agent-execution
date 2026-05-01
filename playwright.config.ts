// playwright.config.ts — paste into project root
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual',
  snapshotDir: './screenshots/baseline',
  outputDir: './screenshots/current',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,   // 2% pixel tolerance per viewport
      animations: 'disabled',
      caret: 'hide',
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile',  use: { ...devices['iPhone 13']     } },
    { name: 'tablet',  use: { ...devices['iPad Pro']      } },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
