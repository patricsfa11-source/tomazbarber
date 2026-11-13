import { rmSync } from 'node:fs';
// Banco descartável reservado ao Playwright, separado da base local de desenvolvimento.
rmSync(new URL('../work/e2e', import.meta.url), { recursive: true, force: true });
