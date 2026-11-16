import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/pilot',
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:8789',
    locale: 'pt-BR',
    viewport: { width: 390, height: 844 },
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/pilot.mjs test-local',
    url: 'http://127.0.0.1:8789/api/services',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
