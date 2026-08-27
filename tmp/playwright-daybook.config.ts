import 'dotenv/config';

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: /daybook-controls\.spec\.ts/,
  outputDir: '../test-results/daybook-controls',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.DAYBOOK_TEST_BASE_URL ?? 'http://localhost:3177',
    ...devices['Desktop Chrome'],
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});