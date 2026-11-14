import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { addDays, localDate, timeLabel } from '../../src/shared';
import type { ScheduleCommand, ScheduleView } from '../../src/calendar';
const origin = 'http://127.0.0.1:8788',
  tomaz = 'tomaz-barber',
  aurora = 'salao-aurora';
let day = addDays(localDate(), 28);
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
  phone: string,
  time: string,
  date = day,
  name = 'Cliente Fictício',
) {
  const response = await api(r, shop, '/bookings', {
    name,
    phone,
    serviceId: 'corte',
    startsAt: at(time, date),
    requestKey: crypto.randomUUID(),
  });
  expect(response.status()).toBe(201);
  return (await response.json()).appointment.id as string;
}
async function message(request: APIRequestContext, challengeId: string) {
  const response = await request.get(`http://127.0.0.1:8790/messages?challengeId=${challengeId}`, {
    headers: { Authorization: 'Bearer chave-ficticia-exclusiva-do-remetente-e2e' },
  });
  expect(response.status()).toBe(200);
  return response.json() as Promise<{ code: string; phone: string }>;
}
async function verify(page: Page, shop: string, phone: string) {
  await page.goto(`/s/${shop}/meus-horarios`);
  await page.getByLabel('Celular com DDD').fill(phone);
  const responsePromise = page.waitForResponse((r) => r.url().endsWith('/customer/verification'));
  await page.getByRole('button', { name: 'Receber código pelo WhatsApp' }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const sent = await message(page.request, (await response.json()).challengeId);
  await page.getByLabel('Código de verificação').fill(sent.code);
  await page.getByRole('button', { name: 'Ver meus horários' }).click();
  await expect(page.locator('.my-session')).toContainText('Celular verificado');
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}
test('cliente verifica WhatsApp, remarca com conflito preservado e cancela pelo celular', async ({
  page,
  request,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const phone = '75999990410',
    other = '75999990411';
  const id = await book(request, tomaz, phone, '09:00', day, 'Alice Fictícia');
  await book(request, tomaz, other, '10:00', day, 'Bruno Fictício');
  await page.goto(`/s/${tomaz}`);
  await page.screenshot({ path: info.outputPath('catalogo-mobile.png'), fullPage: true });
  await page.getByRole('link', { name: 'Meus horários', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Meus horários', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('acesso-mobile.png'), fullPage: true });
  await page.getByLabel('Celular com DDD').fill(phone);
  const start = page.waitForResponse((r) => r.url().endsWith('/customer/verification'));
  await page.getByRole('button', { name: 'Receber código pelo WhatsApp' }).click();
  const response = await start;
  expect(response.status()).toBe(201);
  const sent = await message(request, (await response.json()).challengeId);
  await expect(page.getByRole('heading', { name: 'Confira seu WhatsApp.' })).toBeVisible();
  await fits(page);
  await page.screenshot({ path: info.outputPath('codigo-mobile.png'), fullPage: true });
  await page.getByLabel('Código de verificação').fill(sent.code === '000000' ? '111111' : '000000');
  await page.getByRole('button', { name: 'Ver meus horários' }).click();
  await expect(page.getByRole('alert')).toContainText('Código incorreto');
  await page.getByLabel('Código de verificação').fill(sent.code);
  await page.getByRole('button', { name: 'Ver meus horários' }).click();
  await expect(page.locator('.my-session')).toContainText('Celular verificado');
  await expect(page.locator('.my-bookings > li')).toHaveCount(1);
  await expect(page.locator('.my-bookings')).toContainText('09:00');
  await fits(page);
  await page.screenshot({ path: info.outputPath('meus-horarios-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Remarcar', exact: true }).click();
  await expect(page.getByText('Seu horário atual está reservado.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '11:00', exact: true }).click();
  await book(request, tomaz, other, '11:00', day, 'Bruno Fictício');
  await page.getByRole('button', { name: 'Confirmar remarcação', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('original foi preservada');
  expect(
    (await (await api(page.request, tomaz, `/customer/bookings/${id}`)).json()).appointment
      .startsAt,
  ).toBe(at('09:00'));
  await page.getByRole('button', { name: 'Tarde', exact: true }).click();
  await page.getByRole('button', { name: '12:00', exact: true }).click();
  await fits(page);
  await page.screenshot({ path: info.outputPath('remarcacao-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Confirmar remarcação', exact: true }).click();
  await expect(page.locator('.success-note')).toContainText('Horário remarcado');
  await expect(page.locator('.my-bookings')).toContainText('12:00');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(
    page.getByText('Cancelamento sem custo com pelo menos 2 horas de antecedência.', {
      exact: true,
    }),
  ).toBeVisible();
  await fits(page);
  await page.screenshot({ path: info.outputPath('cancelamento-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Confirmar cancelamento', exact: true }).click();
  await expect(page.locator('.success-note')).toContainText('Reserva cancelada sem custo');
  await expect(page.locator('.my-bookings')).toContainText('Reserva cancelada');
  await page.screenshot({ path: info.outputPath('historico-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 740 });
  await fits(page);
  await page.getByRole('button', { name: 'Próximos', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Seu próximo cuidado começa aqui.' }),
  ).toBeVisible();
  await fits(page);
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page.getByLabel('Celular com DDD')).toBeVisible();
  await fits(page);
  expect(errors).toEqual([]);
});
test('dois clientes e dois estabelecimentos mantêm sessões e reservas separadas no navegador', async ({
  page,
  browser,
  request,
}) => {
  const date = addDays(day, 7),
    alice = '75999990420',
    bob = '75999990421';
  const a = await book(request, tomaz, alice, '13:00', date),
    b = await book(request, tomaz, bob, '14:00', date),
    c = await book(request, aurora, alice, '13:00', date);
  await verify(page, tomaz, alice);
  await expect(page.locator('.my-bookings > li')).toHaveCount(1);
  await expect(page.locator('.my-bookings')).toContainText('13:00');
  expect((await api(page.request, tomaz, `/customer/bookings/${b}`)).status()).toBe(404);
  expect((await api(page.request, tomaz, `/customer/bookings/${c}`)).status()).toBe(404);
  expect((await api(page.request, aurora, '/customer/bookings')).status()).toBe(401);
  const context = await browser.newContext({
    viewport: { width: 320, height: 740 },
    locale: 'pt-BR',
    baseURL: origin,
  });
  const second = await context.newPage();
  await verify(second, tomaz, bob);
  await fits(second);
  await expect(second.locator('.my-bookings')).toContainText('14:00');
  expect(
    (
      await api(second.request, tomaz, `/customer/bookings/${a}/cancel`, {
        expectedVersion: 1,
        requestKey: crypto.randomUUID(),
      })
    ).status(),
  ).toBe(404);
  await verify(page, aurora, alice);
  await expect(page.getByRole('heading', { name: 'Meus horários' })).toBeVisible();
  await expect(page.locator('.my-heading')).toContainText('Salão Aurora');
  await expect(page.locator('.my-bookings > li')).toHaveCount(1);
  await page.goto(`/s/${tomaz}/meus-horarios`);
  await expect(page.locator('.my-session')).toBeVisible();
  await expect(page.locator('.my-heading')).toContainText('TOMAZ BARBER');
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await page.goto(`/s/${aurora}/meus-horarios`);
  await expect(page.locator('.my-session')).toBeVisible();
  await context.close();
});

test('alteração dentro de duas horas orienta falar com o salão e preserva a reserva', async ({
  page,
  request,
}, info) => {
  const phone = '75999990430',
    start = Math.ceil((Date.now() / 1000 + 3600) / 600) * 600;
  const date = localDate(new Date(start * 1000));
  const login = await api(request, tomaz, '/admin/login', {
    password: 'senha-ficticia-e2e-local-123',
  });
  expect(login.status()).toBe(200);
  async function save(command: ScheduleCommand) {
    const config = (await (await api(request, tomaz, '/admin/schedule')).json()) as ScheduleView;
    const p = await api(request, tomaz, '/admin/schedule/preview', {
      command,
      expectedRevision: config.revision,
    });
    expect(p.status()).toBe(200);
    const preview = await p.json();
    const r = await api(request, tomaz, '/admin/schedule/save', {
      command: preview.command,
      expectedRevision: preview.revision,
      previewToken: preview.previewToken,
    });
    expect(r.status()).toBe(200);
    return r.json() as Promise<ScheduleView>;
  }
  const config = await save({
    kind: 'special',
    from: date,
    to: date,
    closed: false,
    opensAt: 0,
    closesAt: 1440,
    breaks: [],
  });
  const special = config.specials.find((s) => s.from === date && s.to === date)!;
  let id = '';
  try {
    id = await book(request, tomaz, phone, timeLabel(start), date, 'Cliente Prazo Pendente');
  } finally {
    await save({ kind: 'remove-special', id: special.id });
  }
  await verify(page, tomaz, phone);
  await page.getByRole('button', { name: 'Sobre cancelamento', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Combine com o salão', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Sua reserva continua confirmada.', { exact: false })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Confirmar cancelamento', exact: true }),
  ).toHaveCount(0);
  await fits(page);
  await page.screenshot({ path: info.outputPath('prazo-pendente-mobile.png'), fullPage: true });
  const response = await api(page.request, tomaz, `/customer/bookings/${id}/cancel`, {
    expectedVersion: 1,
    requestKey: crypto.randomUUID(),
  });
  expect(response.status()).toBe(422);
  expect(
    (await (await api(page.request, tomaz, `/customer/bookings/${id}`)).json()).appointment.status,
  ).toBe('confirmed');
  await page.setViewportSize({ width: 320, height: 740 });
  await fits(page);
});
