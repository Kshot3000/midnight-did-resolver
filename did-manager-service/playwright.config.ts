import { defineConfig } from '@playwright/test';
import { getChromiumExecutablePath } from '../scripts/playwright-browser.mjs';

const executablePath = getChromiumExecutablePath();

export default defineConfig({
  testDir: './src/e2e',
  timeout: 180_000,
  expect: {
    timeout: 30_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    headless: true,
    ...(executablePath === undefined ? {} : { launchOptions: { executablePath } }),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
