import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          ADMIN_PASSWORD: 'senha-ficticia-para-testes-123',
          ADMIN_PASSWORDS: JSON.stringify({
            'tomaz-barber': 'senha-ficticia-para-testes-123',
            'salao-aurora': 'senha-ficticia-aurora-testes-456',
          }),
          TEST_MIGRATIONS: await readD1Migrations('./migrations'),
          TEST_AURORA_MIGRATIONS: await readD1Migrations('./fixtures'),
        },
      },
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
  },
}));
