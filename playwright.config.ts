import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end QA configuration (MOCKED backend).
 *
 * The suite runs against the local Angular dev server. Every network request
 * to the real Apps Script endpoint is intercepted by `e2e/fixtures.ts` and
 * answered with disposable test data; unmocked requests to the production
 * endpoint are aborted, so no test traffic ever reaches production.
 *
 * Browsers: Chromium only (per approval). Mobile and tablet coverage is
 * device EMULATION — physical devices are not exercised by this suite.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4200',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npx ng serve --port 4200',
    url: 'http://localhost:4200',
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Mobile web emulation (Android/Chrome-style), NOT a physical device.
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
    },
    {
      // Tablet emulation, Chromium engine (WebKit/tablet hardware not claimed).
      name: 'tablet-chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 768, height: 1024 },
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
});
