import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { addDays, localDate } from '../../src/shared';
const origin = 'http://127.0.0.1:8788',
  tomaz = 'tomaz-barber',
  aurora = 'salao-aurora';
let day = addDays(localDate(), 49);
while ([0, 1].includes(new Date(`${day}T12:00:00Z`).getUTCDay())) day = addDays(day, 1);
const at = (time: string, date = day) => Date.parse(`${date}T${time}:00-03:00`) / 1000;
const api = (r: APIRequestContext, shop: string, path: string, data?: unknown) =>
  r.fetch(`/api/shops/${shop}${path}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { Origin: origin },
    data,
  });
async function book(
  r: APIRequestContext,
  shop: string,
  time: string,
  phone = '75999990611',
  date = day,
) {
  const response = await api(r, shop, '/bookings', {
    name: 'Cliente Fictício',
    phone,
    serviceId: 'corte',
    startsAt: at(time, date),
    requestKey: crypto.randomUUID(),
  });
  expect(response.status()).toBe(201);
  return (await response.json()).appointment;
}
async function login(page: Page, shop = tomaz) {
  await page.goto(`/s/${shop}/hub`);
  await page
    .getByLabel('Senha do hub')
    .fill(shop === tomaz ? 'senha-ficticia-e2e-local-123' : 'senha-ficticia-aurora-e2e-123');
  await page.getByRole('button', { name: 'Entrar no hub', exact: true }).click();
  await expect(page.getByLabel('Data da agenda')).toBeVisible();
}
const fits = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
test('cliente agenda no celular, guarda link privado e remarca/cancela sem Meta', async ({
  page,
  request,
  browser,
}, info) => {
  const calls: string[] = [];
  page.on('request', (r) => calls.push(r.url()));
  await page.goto(`/s/${tomaz}`);
  await page.screenshot({ path: info.outputPath('catalogo-mobile.png'), fullPage: true });
  await fits(page);
  await page.getByRole('button', { name: 'Agendar Corte masculino', exact: true }).click();
  await page.getByLabel('Data do atendimento').fill(day);
  await page.getByRole('button', { name: '09:00', exact: true }).click();
  await page.screenshot({ path: info.outputPath('horarios-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByLabel('Nome completo', { exact: true }).fill('Ana Cliente Fictícia');
  await page.getByLabel('Celular com DDD', { exact: true }).fill('75999990610');
  await page.screenshot({ path: info.outputPath('dados-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Confirmar reserva', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nos vemos em breve.' })).toBeVisible();
  const manage = page.getByRole('link', {
    name: 'Consultar ou alterar esta reserva',
    exact: false,
  });
  const href = (await manage.getAttribute('href'))!;
  expect(href).toContain('#acesso=');
  await page.screenshot({ path: info.outputPath('confirmacao-mobile.png'), fullPage: true });
  await fits(page);
  const other = await book(request, tomaz, '10:00');
  const stranger = await browser.newContext({
    baseURL: origin,
    viewport: { width: 390, height: 844 },
  });
  const unknown = await stranger.newPage();
  await unknown.goto(href.split('#')[0]);
  await expect(unknown.getByRole('heading', { name: 'Abra seu link privado.' })).toBeVisible();
  const id = href.split('/reserva/')[1].split('#')[0];
  expect(
    (
      await api(stranger.request, tomaz, `/booking-access/${id}?phone=75999990610&name=Ana`)
    ).status(),
  ).toBe(401);
  await stranger.close();
  await manage.click();
  await expect(page.getByRole('heading', { name: 'Sua reserva', exact: true })).toBeVisible();
  await expect(page.locator('.my-booking-summary')).toContainText('09:00');
  expect(new URL(page.url()).hash).toBe('');
  expect((await api(page.request, tomaz, `/booking-access/${other.id}`)).status()).toBe(401);
  await page.screenshot({ path: info.outputPath('reserva-privada-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Remarcar', exact: true }).click();
  await page.getByRole('button', { name: '11:00', exact: true }).click();
  await book(request, tomaz, '11:00');
  await page.getByRole('button', { name: 'Confirmar remarcação', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('original foi preservada');
  expect(
    (await (await api(page.request, tomaz, `/booking-access/${id}`)).json()).appointment.startsAt,
  ).toBe(at('09:00'));
  await page.getByRole('button', { name: 'Tarde', exact: true }).click();
  await page.getByRole('button', { name: '12:00', exact: true }).click();
  await page.screenshot({ path: info.outputPath('remarcacao-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Confirmar remarcação', exact: true }).click();
  await expect(page.locator('.success-note')).toContainText('Novo horário confirmado');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.screenshot({ path: info.outputPath('cancelamento-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Confirmar cancelamento', exact: true }).click();
  await expect(page.locator('.status')).toContainText('Cancelada');
  await fits(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await fits(page);
  expect(
    calls.some(
      (url) => url.includes('graph.facebook.com') || url.includes('/customer/verification'),
    ),
  ).toBe(false);
});
test('hub cadastra, encaixa e divulga links e QR Codes corretos para os dois estabelecimentos', async ({
  page,
  request,
}, info) => {
  for (const [index, shop] of [tomaz, aurora].entries()) {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, shop);
    await expect(page.getByLabel('Data da agenda')).toHaveValue(localDate());
    await page.getByRole('button', { name: 'Clientes', exact: true }).click();
    await page.getByRole('button', { name: 'Cadastrar cliente', exact: false }).click();
    const name = shop === tomaz ? 'Cliente Novo da Tomaz' : 'Cliente Novo da Aurora';
    await page.getByLabel('Nome completo do cliente', { exact: true }).fill(name);
    await page.getByLabel('Celular do cliente com DDD', { exact: true }).fill('75999990620');
    await page.getByRole('button', { name: 'Salvar cliente', exact: true }).click();
    const card = page.locator('.customers > li').filter({ hasText: name });
    await expect(card).toBeVisible();
    await expect(page.locator('.customers')).not.toContainText(
      shop === tomaz ? 'Cliente Novo da Aurora' : 'Cliente Novo da Tomaz',
    );
    await page.screenshot({ path: info.outputPath(`clientes-${shop}-mobile.png`), fullPage: true });
    await card.getByRole('button', { name: 'Marcar horário', exact: true }).click();
    await page.getByRole('radio', { name: /Corte/ }).first().click();
    await page.getByRole('button', { name: 'Escolher horário', exact: true }).click();
    await page.getByLabel('Data do atendimento').fill(addDays(day, 1));
    await page.getByRole('button', { name: '13:00', exact: true }).click();
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByLabel('Nome completo', { exact: true })).toHaveValue(name);
    await page.getByRole('button', { name: 'Confirmar encaixe', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Encaixe confirmado.' })).toBeVisible();
    await page.getByRole('button', { name: 'Voltar à agenda', exact: true }).click();
    await expect(page.locator('.appointments')).toContainText(name);
    await page.screenshot({ path: info.outputPath(`agenda-${shop}-mobile.png`), fullPage: true });
    await fits(page);
    await page.getByRole('button', { name: 'Divulgar agendamento', exact: false }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Link de agendamento')).toHaveValue(`${origin}/s/${shop}`);
    const share = dialog.getByRole('link', { name: 'Compartilhar pelo WhatsApp', exact: false });
    expect(new URL((await share.getAttribute('href'))!).searchParams.get('text')).toContain(
      `${origin}/s/${shop}`,
    );
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await dialog.getByRole('button', { name: 'Copiar link de agendamento', exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${origin}/s/${shop}`);
    const downloadEvent = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Baixar QR Code em PNG', exact: true }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe(`${shop}-agendamento.png`);
    const path = info.outputPath(`${shop}-qr.png`);
    await download.saveAs(path);
    const png = PNG.sync.read(await readFile(path));
    const qr = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    expect(qr?.data).toBe(`${origin}/s/${shop}`);
    await page.screenshot({
      path: info.outputPath(`compartilhar-${shop}-mobile.png`),
      fullPage: true,
    });
    await page.setViewportSize({ width: 320, height: 740 });
    await fits(page);
    await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
    const manifest = await (await request.get(`/s/${shop}/hub.webmanifest`)).json();
    expect(manifest.id).toBe(`/s/${shop}/hub`);
    expect(manifest.start_url).toBe(`/s/${shop}/hub`);
    if (index === 0) {
      const cdp = await page.context().newCDPSession(page);
      const m = await cdp.send('Page.getAppManifest');
      expect(m.errors).toEqual([]);
      await cdp.detach();
    }
  }
});
test('hub tem instalação e fallback offline sem guardar agenda ou clientes no cache', async ({
  page,
  context,
  request,
}, info) => {
  await login(page);
  await page.getByRole('button', { name: 'Instalar hub', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Adicionar à tela inicial');
  await page.screenshot({ path: info.outputPath('instalar-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    return (
      await Promise.all(
        names.map(async (n) =>
          (await (await caches.open(n)).keys()).map((r) => new URL(r.url).pathname),
        ),
      )
    ).flat();
  });
  expect(cached).toContain('/offline-hub.html');
  expect(cached.some((p) => p.startsWith('/api/') || p.startsWith('/s/'))).toBe(false);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Vamos reconectar.' })).toBeVisible();
  await expect(page.locator('.appointments,.customers')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('hub-offline-mobile.png'), fullPage: true });
  await fits(page);
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByLabel('Data da agenda')).toBeVisible();
  await page.getByRole('button', { name: 'Sair do hub', exact: false }).click();
  await page.reload();
  await expect(page.getByLabel('Senha do hub')).toBeVisible();
  expect((await api(page.request, tomaz, '/admin/customers')).status()).toBe(401);
  const other = await request.get(`/s/${aurora}/hub.webmanifest`);
  expect((await other.json()).id).not.toBe(`/s/${tomaz}/hub`);
});
