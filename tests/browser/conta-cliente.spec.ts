import { test, expect } from '@playwright/test';
import { addDays, localDate } from '../../src/shared';
test('confirmação e link individual mostram intervalo; conta associa convidado e mantém sessão', async ({
  page,
  browser,
}, info) => {
  const origin = 'http://127.0.0.1:8788',
    shop = 'tomaz-barber',
    phone = '75999990907';
  let day = addDays(localDate(), 80);
  while (new Date(day + 'T12:00Z').getUTCDay() === 0) day = addDays(day, 1);
  await page.goto(`/s/${shop}`);
  await page.getByRole('button', { name: 'Agendar Corte masculino', exact: true }).click();
  await page.getByLabel('Data do atendimento').fill(day);
  await page.getByRole('button', { name: '08:00', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByLabel('Nome completo', { exact: true }).fill('Conta Cliente Fictícia');
  await page.getByLabel('Celular com DDD', { exact: true }).fill(phone);
  await page.getByRole('button', { name: 'Confirmar reserva', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nos vemos em breve.' })).toBeVisible();
  const summary = page.locator('.confirmed-details');
  await expect(summary.locator('.reservation-status')).toHaveText('Confirmada');
  await expect(summary.locator('.reservation-interval')).toHaveText('08:00–08:30');
  await expect(summary.locator('.reservation-price')).toContainText('R$ 33,00 no cartão');
  await expect(page.getByRole('link', { name: 'Ver meus horários', exact: true })).toBeVisible();
  const privateLink = await page
    .getByRole('link', { name: 'Consultar ou alterar esta reserva', exact: false })
    .getAttribute('href');
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`confirmacao-${width}.png`), fullPage: true });
  }
  await page.goto(privateLink!);
  await expect(page.locator('.my-booking-summary .reservation-interval')).toHaveText('08:00–08:30');
  await expect(
    page.locator('.my-booking-actions').getByRole('button', { name: 'Remarcar', exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('.my-booking-actions').getByRole('button', { name: 'Cancelar', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath('sua-reserva.png'), fullPage: true });
  await page.goto(`/s/${shop}/meus-horarios`);
  await page.getByLabel('Nome completo', { exact: true }).fill('Conta Cliente Fictícia');
  await page.getByLabel('Número do WhatsApp com DDD').fill(phone);
  const sent = page.waitForResponse((r) => r.url().endsWith('/customer/verification'));
  await page.getByRole('button', { name: 'Receber código por SMS', exact: true }).click();
  const response = await sent;
  expect(response.status()).toBe(201);
  const id = (await response.json()).challengeId;
  const code = (
    await (
      await page.request.get(`http://127.0.0.1:8790/messages?challengeId=${id}`, {
        headers: { Authorization: 'Bearer chave-ficticia-exclusiva-do-remetente-e2e' },
      })
    ).json()
  ).code;
  await page.getByLabel('Código de verificação').fill(code);
  await page.getByRole('button', { name: 'Ver meus horários', exact: true }).click();
  await expect(page.locator('.my-bookings')).toContainText('08:00–08:30');
  await expect(page.locator('.my-session')).toContainText('Conta Cliente Fictícia');
  await page.reload();
  await expect(page.locator('.my-bookings')).toContainText('08:00–08:30');
  await expect(page.getByRole('button', { name: 'Próximos horários', exact: true })).toBeVisible();
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`conta-${width}.png`), fullPage: true });
  }
  const stranger = await browser.newContext({ baseURL: origin });
  expect((await stranger.request.get('/api/shops/tomaz-barber/customer/bookings')).status()).toBe(
    401,
  );
  await stranger.close();
  const session = (await page.context().cookies()).find((c) => c.name === 'tb_customer');
  expect(session?.expires).toBeGreaterThan(Date.now() / 1000 + 29 * 86400);
});
