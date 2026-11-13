import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:8788',
    locale: 'pt-BR',
    viewport: { width: 390, height: 844 },
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev:e2e',
    url: 'http://127.0.0.1:8788/api/services',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
