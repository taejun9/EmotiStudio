import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.CI ? {} : { channel: 'chrome' },
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'node --import tsx scripts/e2e-server.ts',
        url: 'http://127.0.0.1:4173/api/health',
        reuseExistingServer: false,
        gracefulShutdown: { signal: 'SIGTERM', timeout: 15_000 },
        timeout: 60_000,
      },
});
