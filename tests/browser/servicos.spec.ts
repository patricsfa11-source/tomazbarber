import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { addDays, localDate } from '../../src/shared';
test('dono publica, edita, desativa e reativa serviço pelo Hub sem alterar reserva antiga', async ({
  page,
  browser,
}, info) => {
  // A suíte compartilha um banco descartável e ultrapassa dez logins no mesmo IP.
  // Reiniciar somente o contador dessa base, sem alterar a proteção do Worker.
  execFileSync(
    'node_modules/.bin/wrangler',
    [
      'd1',
      'execute',
      'tomazbarber-dev',
      '--local',
      '--persist-to',
      'work/e2e',
      '--command',
      'DELETE FROM login_attempts',
    ],
    { stdio: 'pipe', env: process.env },
  );
  const shop = 'tomaz-barber',
    origin = 'http://127.0.0.1:8788',
    path = `/api/shops/${shop}`;
  const visitor = await browser.newContext({
      baseURL: origin,
      viewport: { width: 390, height: 844 },
    }),
    pub = await visitor.newPage();
  await page.goto(`/s/${shop}/hub`);
  await page.getByLabel('Senha do hub').fill('senha-ficticia-e2e-local-123');
  await page.getByRole('button', { name: 'Entrar no hub', exact: true }).click();
  await expect(page.getByLabel('Data da agenda')).toBeVisible();
  await page.getByRole('button', { name: 'Serviços', exact: true }).click();
  await page.getByRole('button', { name: '+ Novo serviço', exact: true }).click();
  await page.getByLabel('Nome do serviço', { exact: true }).fill('Serviço Fictício');
  await page.getByLabel('Duração em minutos').fill('50');
  await page.getByLabel('Preço exibido').fill('R$ 50,00');
  await page.getByLabel('Condições de pagamento').fill('Pix ou dinheiro');
  await page.getByLabel('Descrição', { exact: true }).fill('Cuidado especial');
  await page.getByRole('button', { name: 'Salvar serviço', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Serviço salvo');
  await pub.goto(`/s/${shop}`);
  await expect(
    pub.getByRole('button', { name: 'Agendar Serviço Fictício', exact: true }),
  ).toBeVisible();
  const rows = (await (await page.request.get(path + '/admin/services')).json()).services;
  const service = rows.find((s: { name: string }) => s.name === 'Serviço Fictício');
  let day = addDays(localDate(), 70);
  while (new Date(day + 'T12:00Z').getUTCDay() === 0) day = addDays(day, 1);
  const available = (
    await (await pub.request.get(path + `/availability?date=${day}&serviceId=${service.id}`)).json()
  ).slots;
  const r = await pub.request.post(path + '/bookings', {
    headers: { Origin: origin },
    data: {
      name: 'Cliente Serviço Fictício',
      phone: '75999990473',
      serviceId: service.id,
      startsAt: available[0],
      requestKey: crypto.randomUUID(),
    },
  });
  expect(r.status()).toBe(201);
  const old = (await r.json()).appointment;
  await page.getByRole('button', { name: 'Editar Serviço Fictício', exact: true }).click();
  await page.getByLabel('Nome do serviço', { exact: true }).fill('Serviço Renovado');
  await page.getByLabel('Duração em minutos').fill('60');
  await page.getByLabel('Preço exibido').fill('R$ 65,00');
  await page.getByLabel('Condições de pagamento').fill('Somente Pix');
  await page.getByRole('button', { name: 'Salvar serviço', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Serviço salvo');
  await pub.reload();
  const row = pub.locator('.shop-services > li').filter({ hasText: 'Serviço Renovado' });
  await expect(row).toContainText('R$ 65,00');
  await expect(row).toContainText('Somente Pix');
  await expect(row).toContainText('60 min');
  const detail = (await (await page.request.get(path + `/admin/bookings/${old.id}`)).json())
    .appointment;
  expect(detail).toMatchObject({
    service_name: 'Serviço Fictício',
    duration_minutes: 50,
    price_label: 'R$ 50,00 · Pix ou dinheiro',
    starts_at: available[0],
    ends_at: available[0] + 3000,
  });
  await page.getByRole('button', { name: 'Editar Serviço Renovado', exact: true }).click();
  await page.getByLabel('Ativo para novos agendamentos').uncheck();
  await page.getByRole('button', { name: 'Salvar serviço', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Serviço salvo');
  await pub.reload();
  await expect(
    pub.getByRole('button', { name: 'Agendar Serviço Renovado', exact: true }),
  ).toHaveCount(0);
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`servicos-${width}.png`), fullPage: true });
  }
  await page.getByRole('button', { name: 'Editar Serviço Renovado', exact: true }).click();
  await page.getByLabel('Ativo para novos agendamentos').check();
  await page.getByRole('button', { name: 'Salvar serviço', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Serviço salvo');
  await pub.reload();
  await expect(
    pub.getByRole('button', { name: 'Agendar Serviço Renovado', exact: true }),
  ).toBeVisible();
  expect((await visitor.request.get(path + '/admin/services')).status()).toBe(401);
  await page.goto('/s/salao-aurora/hub');
  await expect(page.getByLabel('Senha do hub')).toBeVisible();
  await page.getByLabel('Senha do hub').fill('senha-ficticia-aurora-e2e-123');
  await page.getByRole('button', { name: 'Entrar no hub', exact: true }).click();
  await expect(page.getByLabel('Data da agenda')).toBeVisible();
  await page.getByRole('button', { name: 'Serviços', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Editar Corte e finalização', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Editar Serviço Renovado', exact: true }),
  ).toHaveCount(0);
  await visitor.close();
});
