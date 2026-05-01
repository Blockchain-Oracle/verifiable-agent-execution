// scripts/capture-anchor.ts — one-time anchor capture, day-0
// Run: pnpm tsx scripts/capture-anchor.ts <anchor-url>
// Output: screenshots/anchor/<slug>--<viewport>.png at 3 viewports

import { chromium, devices } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const VIEWPORTS = [
  { name: 'desktop', device: devices['Desktop Chrome'] },
  { name: 'mobile',  device: devices['iPhone 13']     },
  { name: 'tablet',  device: devices['iPad Pro']      },
];

// Edit per project. Each entry: route on the anchor product + slug for filename.
const ROUTES: Array<{ url: string; slug: string }> = [
  { url: '/', slug: 'home' },
  // { url: '/dashboard', slug: 'dashboard' },
];

async function main() {
  const baseURL = process.argv[2];
  if (!baseURL) {
    console.error('Usage: pnpm tsx scripts/capture-anchor.ts <anchor-base-url>');
    console.error('Example: pnpm tsx scripts/capture-anchor.ts https://cal.com');
    process.exit(1);
  }

  const outDir = path.resolve('screenshots/anchor');
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();
  try {
    for (const { name, device } of VIEWPORTS) {
      const context = await browser.newContext({ ...device });
      const page = await context.newPage();
      for (const { url, slug } of ROUTES) {
        const target = new URL(url, baseURL).toString();
        console.log(`[${name}] ${target}`);
        await page.goto(target, { waitUntil: 'networkidle', timeout: 30_000 });
        // Let lazy content settle
        await page.waitForTimeout(1500);
        const file = path.join(outDir, `${slug}--${name}.png`);
        await page.screenshot({ path: file, fullPage: true });
        console.log(`  -> ${file}`);
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  console.log('\nAnchor capture complete. Files in screenshots/anchor/ are now immutable.');
  console.log('Commit them. Never overwrite.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
