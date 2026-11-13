import { test, expect, type Page } from '@playwright/test';

let day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bahia' }).format(
  new Date(Date.now() + 86400000),
);
while (new Date(`${day}T12:00:00-03:00`).getUTCDay() === 0)
  day = new Date(Date.parse(`${day}T12:00:00-03:00`) + 86400000).toISOString().slice(0, 10);
async function choose(page: Page, service: string, time: string) {
  await page.getByRole('radio', { name: new RegExp(service) }).click();
  await page.getByRole('button', { name: 'Escolher horário' }).click();
  await page.getByLabel('Data do atendimento').fill(day);
  await page.getByRole('button', { name: time, exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
}
test('cliente reserva no celular e o hub vê a mesma reserva; encaixe some do link', async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('radio')).toHaveCount(7);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'work/cliente-mobile.png', fullPage: true });
  await choose(page, 'Corte com barba', '10:00');
  await expect(page.getByText('R$ 38,00').first()).toBeVisible();
  await page.getByLabel('Nome completo').fill('Cliente Fictício');
  await page.getByLabel('Celular com DDD').fill('75999990000');
  await expect(page.getByText('Chegue 10 minutos antes.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar reserva' }).click();
  await expect(page.getByRole('heading', { name: 'Nos vemos em breve.' })).toBeVisible();
  await page.screenshot({ path: 'work/confirmacao-mobile.png', fullPage: true });

  const adminContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'pt-BR',
  });
  const admin = await adminContext.newPage();
  await admin.goto('http://127.0.0.1:8788/hub');
  await expect(admin.getByLabel('Senha do hub')).toBeVisible();
  await expect(admin.getByText('Cliente Fictício')).toHaveCount(0);
  await admin.getByLabel('Senha do hub').fill('senha-ficticia-e2e-local-123');
  await admin.getByRole('button', { name: 'Entrar no hub' }).click();
  await admin.getByLabel('Data da agenda').fill(day);
  await expect(admin.getByRole('heading', { name: 'Cliente Fictício' })).toBeVisible();
  await admin.getByRole('button', { name: 'Novo encaixe' }).click();
  await choose(admin, 'Barba Contorno', '11:00');
  await admin.getByLabel('Nome completo').fill('Encaixe Fictício');
  await admin.getByLabel('Celular com DDD').fill('75999990001');
  await admin.getByRole('button', { name: 'Confirmar encaixe' }).click();
  await expect(admin.getByRole('heading', { name: 'Encaixe confirmado.' })).toBeVisible();
  await admin.getByRole('button', { name: 'Voltar à agenda' }).click();
  await expect(admin.getByRole('heading', { name: 'Encaixe Fictício' })).toBeVisible();
  await admin.screenshot({ path: 'work/hub-mobile.png', fullPage: true });
  expect(
    await admin.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);

  await page.goto('/');
  await page.getByRole('button', { name: 'Escolher horário' }).click();
  await page.getByLabel('Data do atendimento').fill(day);
  await expect(page.getByRole('button', { name: '11:20', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '10:00', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '10:40', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '11:00', exact: true })).toHaveCount(0);
  await admin.getByRole('button', { name: 'Sair do hub' }).click();
  await expect(admin.getByLabel('Senha do hub')).toBeVisible();
  expect(errors).toEqual([]);
  await adminContext.close();
});
test('conflito após seleção de horário atualiza opções e preserva dados digitados', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await choose(page, 'Corte masculino', '14:00');
  await page.getByLabel('Nome completo').fill('Reserva Fictícia');
  await page.getByLabel('Celular com DDD').fill('75999990002');
  const response = await request.post('/api/bookings', {
    headers: { Origin: 'http://127.0.0.1:8788' },
    data: {
      serviceId: 'barba',
      startsAt: Date.parse(`${day}T14:10:00-03:00`) / 1000,
      name: 'Outro Fictício',
      phone: '75999990003',
      requestKey: crypto.randomUUID(),
    },
  });
  expect(response.status()).toBe(201);
  await page.getByRole('button', { name: 'Confirmar reserva' }).click();
  await expect(page.getByRole('alert')).toContainText('Esse intervalo acabou de ser reservado');
  await expect(page.getByRole('button', { name: '14:00', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '14:30', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByLabel('Nome completo')).toHaveValue('Reserva Fictícia');
  await expect(page.getByLabel('Celular com DDD')).toHaveValue('75999990002');
  await page.getByRole('button', { name: 'Confirmar reserva' }).click();
  await expect(page.getByRole('heading', { name: 'Nos vemos em breve.' })).toBeVisible();
});
test('catálogo e login também cabem em tela de 320px e desktop', async ({ page }) => {
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('radio')).toHaveCount(7);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: `work/catalogo-${width}.png`, fullPage: true });
    await page.goto('/hub');
    await expect(page.getByLabel('Senha do hub')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
});
