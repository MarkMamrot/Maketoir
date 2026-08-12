import 'dotenv/config';

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/live-monsterthreads/global-setup.ts',
  globalTeardown: './e2e/live-monsterthreads/global-teardown.ts',
  outputDir: 'test-results/playwright-artifacts',
  fullyParallel: false,
  forbidOnly: true,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'test-results/playwright-report', open: 'never' }]],
  use: {
    baseURL: process.env.LIVE_E2E_BASE_URL ?? 'http://localhost:3000',
    screenshot: 'on',
    trace: 'on',
    video: 'retain-on-failure',
  },
  projects: [{
    name: 'live-monsterthreads',
    use: { ...devices['Desktop Chrome'] },
    testMatch: /live-monsterthreads\/.*\.spec\.ts/,
  }],
});