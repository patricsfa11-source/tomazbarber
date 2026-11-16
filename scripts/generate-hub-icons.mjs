import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
// Enquadramento de apresentação da imagem original; o JPG original nunca é alterado.
const logo = (await readFile(new URL('../public/tomaz-barber-logo.jpg', import.meta.url))).toString(
  'base64',
);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
await mkdir(new URL('../public/icons/', import.meta.url), { recursive: true });
try {
  const page = await browser.newPage({
    viewport: { width: 512, height: 512 },
    deviceScaleFactor: 1,
  });
  for (const shop of ['tomaz-barber', 'salao-aurora'])
    for (const size of [192, 512]) {
      await page.setViewportSize({ width: size, height: size });
      const artwork =
        shop === 'tomaz-barber'
          ? `<svg viewBox="0 334 900 932" xmlns="http://www.w3.org/2000/svg"><image href="data:image/jpeg;base64,${logo}" width="900" height="1600"/></svg>`
          : `<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"><rect width="512" height="512" fill="#121412"/><circle cx="256" cy="256" r="194" fill="none" stroke="#d5b36b" stroke-width="6"/><text x="256" y="280" text-anchor="middle" font-family="Arial" font-size="140" fill="#d5b36b">SA</text><text x="256" y="340" text-anchor="middle" font-family="Arial" letter-spacing="8" font-size="28" fill="#eeeee8">AURORA</text></svg>`;
      await page.setContent(
        `<style>*{box-sizing:border-box}body{margin:0;background:#000}svg{display:block;width:100vw;height:100vh}</style>${artwork}`,
      );
      await page
        .locator('svg')
        .screenshot({
          path: new URL(`../public/icons/${shop}-${size}.png`, import.meta.url).pathname,
        });
    }
} finally {
  await browser.close();
}
