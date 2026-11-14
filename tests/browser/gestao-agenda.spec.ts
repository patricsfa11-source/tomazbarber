import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import type { ScheduleView, ScheduleCommand, AppointmentDetail } from '../../src/calendar';
let day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bahia' }).format(
  new Date(Date.now() + 8 * 86400000),
);
while ([0, 1].includes(new Date(`${day}T12:00:00Z`).getUTCDay()))
  day = new Date(Date.parse(`${day}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
const add = (date: string, n: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const origin = 'http://127.0.0.1:8788';
async function api(request: APIRequestContext, shop: string, path: string, data?: unknown) {
  const response = await request.fetch(`/api/shops/${shop}${path}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { Origin: origin },
    data,
  });
  return response;
}
async function book(
  request: APIRequestContext,
  shop: string,
  name: string,
  time: string,
  date = day,
  manual = false,
  serviceId = 'corte',
) {
  const response = await api(request, shop, manual ? '/admin/bookings' : '/bookings', {
    name,
    phone: '75999990200',
    serviceId,
    startsAt: Date.parse(`${date}T${time}:00-03:00`) / 1000,
    requestKey: crypto.randomUUID(),
  });
  expect(response.status()).toBe(201);
  return (await response.json()).appointment.id as string;
}
async function login(page: Page, shop = 'tomaz-barber') {
  await page.goto(`/s/${shop}/hub`);
  await page
    .getByLabel('Senha do hub')
    .fill(
      shop === 'tomaz-barber' ? 'senha-ficticia-e2e-local-123' : 'senha-ficticia-aurora-e2e-123',
    );
  await page.getByRole('button', { name: 'Entrar no hub' }).click();
  await expect(page.getByLabel('Data da agenda')).toBeVisible();
}
async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Configurar agenda', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Como funciona sua semana?' })).toBeVisible();
}
async function confirmPreview(page: Page) {
  await expect(page.getByRole('heading', { name: 'Revise a alteração.' })).toBeVisible();
  const ack = page.getByRole('checkbox', {
    name: 'Conferi as reservas afetadas e quero preservá-las.',
  });
  if (await ack.count()) await ack.check();
  await page.getByRole('button', { name: 'Salvar configuração', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Configuração salva');
}
async function slots(request: APIRequestContext, shop: string, date: string, manual = false) {
  const r = await api(
    request,
    shop,
    `${manual ? '/admin' : ''}/availability?date=${date}&serviceId=corte`,
  );
  expect(r.status()).toBe(200);
  return (await r.json()).slots as number[];
}
const at = (date: string, time: string) => Date.parse(`${date}T${time}:00-03:00`) / 1000;
async function saveCommand(request: APIRequestContext, shop: string, command: ScheduleCommand) {
  const cfg = (await (await api(request, shop, '/admin/schedule')).json()) as ScheduleView;
  const response = await api(request, shop, '/admin/schedule/preview', {
    command,
    expectedRevision: cfg.revision,
  });
  expect(response.status()).toBe(200);
  const p = await response.json();
  expect(
    (
      await api(request, shop, '/admin/schedule/save', { ...p, expectedRevision: p.revision })
    ).status(),
  ).toBe(200);
}

test('hub mantém o horário antigo em conflito, confirma remarcação e cancela com histórico', async ({
  page,
  request,
}) => {
  const id = await book(request, 'tomaz-barber', 'Cliente Gestão', '13:00');
  await book(request, 'tomaz-barber', 'Outro Gestão', '14:00');
  await login(page);
  await page.getByLabel('Data da agenda').fill(day);
  const row = page
    .locator('.appointments li')
    .filter({ has: page.getByRole('heading', { name: 'Cliente Gestão', exact: true }) });
  await row.getByRole('button', { name: 'Remarcar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Escolha o novo horário.' })).toBeVisible();
  await expect(page.getByRole('button', { name: '14:00', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '13:30', exact: true }).click();
  await book(request, 'tomaz-barber', 'Concorrente Gestão', '13:40', day, false, 'barba');
  await page.getByRole('button', { name: 'Confirmar remarcação' }).click();
  await expect(page.getByRole('alert')).toContainText('reserva original foi preservada');
  const old = (await (
    await api(page.request, 'tomaz-barber', `/admin/bookings/${id}`)
  ).json()) as AppointmentDetail;
  expect(old.appointment.starts_at).toBe(at(day, '13:00'));
  await page.getByRole('button', { name: '14:30', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar remarcação' }).click();
  await expect(page.getByRole('status')).toContainText('Reserva remarcada');
  await expect(row).toContainText('14:30');
  expect(await slots(request, 'tomaz-barber', day)).toContain(at(day, '13:00'));
  await row.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar cancelamento', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('histórico foi preservado');
  await expect(row).toHaveCount(0);
  await page.getByRole('button', { name: 'Histórico', exact: true }).click();
  await expect(row).toContainText('Cancelado');
  await row.getByRole('button', { name: 'Ver histórico', exact: true }).click();
  await expect(page.locator('.booking-timeline')).toContainText('Remarcado');
  await expect(page.locator('.booking-timeline')).toContainText('Cancelado');
});

test('configura faixas no celular, preserva reservas afetadas e mantém o outro salão independente', async ({
  page,
  request,
}) => {
  const date = add(day, 7),
    id = await book(request, 'tomaz-barber', 'Cliente Afetado', '11:00', date);
  await login(page);
  await openSettings(page);
  await page.getByRole('button', { name: 'Faixas e bloqueios', exact: true }).click();
  await page.getByLabel('Data inicial da faixa').fill(date);
  await page.getByLabel('Data final da faixa').fill(date);
  await page.getByLabel('Início da faixa').fill('11:00');
  await page.getByLabel('Fim da faixa').fill('12:00');
  await page.getByRole('button', { name: 'Revisar faixa', exact: true }).click();
  await expect(page.locator('.preview-card')).toContainText('Cliente Afetado');
  await confirmPreview(page);
  await expect(page.locator('.affected-card')).toContainText('Cliente Afetado');
  expect(await slots(request, 'tomaz-barber', date)).not.toContain(at(date, '11:40'));
  expect(await slots(page.request, 'tomaz-barber', date, true)).toContain(at(date, '11:30'));
  await book(page.request, 'tomaz-barber', 'Encaixe Faixa Oculta', '11:30', date, true);
  expect(await slots(request, 'salao-aurora', date)).toContain(at(date, '11:00'));
  await page.getByLabel('Início da faixa').fill('13:00');
  await page.getByLabel('Fim da faixa').fill('14:00');
  await page.getByLabel('Disponibilidade da faixa').selectOption('all');
  await page.getByRole('button', { name: 'Revisar faixa', exact: true }).click();
  await confirmPreview(page);
  expect(await slots(request, 'tomaz-barber', date)).not.toContain(at(date, '13:00'));
  expect(await slots(page.request, 'tomaz-barber', date, true)).not.toContain(at(date, '13:00'));
  expect(await slots(request, 'salao-aurora', date)).toContain(at(date, '13:00'));
  const preserved = (await (
    await api(page.request, 'tomaz-barber', `/admin/bookings/${id}`)
  ).json()) as AppointmentDetail;
  expect(preserved.appointment.status).toBe('confirmed');
  expect(preserved.appointment.version).toBe(1);
  await page.screenshot({ path: 'work/agenda-config-faixas.png', fullPage: true });
  await page.locator('.settings-tabs').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: 'work/agenda-config-faixas-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('edita expediente e pausas, cria abertura especial no domingo e mostra as configurações em celular', async ({
  page,
  request,
}) => {
  await login(page);
  const initial = (await (
    await api(page.request, 'tomaz-barber', '/admin/schedule')
  ).json()) as ScheduleView;
  await openSettings(page);
  await page.getByLabel('Abertura de sábado', { exact: true }).fill('08:00');
  await page.getByLabel('Fechamento de sábado', { exact: true }).fill('19:00');
  await page.getByRole('button', { name: 'Adicionar pausa em sábado' }).click();
  await page.getByRole('button', { name: 'Revisar expediente', exact: true }).click();
  await confirmPreview(page);
  const saturday = initial.days.find((d) => d.weekday === 6)!;
  expect(saturday.opensAt).toBe(450);
  await page.screenshot({ path: 'work/agenda-config-semana.png', fullPage: true });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: 'work/agenda-config-visao-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await saveCommand(page.request, 'tomaz-barber', { kind: 'weekly', days: initial.days });
  await page.reload();
  await openSettings(page);
  await page.getByRole('button', { name: 'Horários especiais', exact: true }).click();
  let sunday = add(day, 15);
  while (new Date(`${sunday}T12:00:00Z`).getUTCDay() !== 0) sunday = add(sunday, 1);
  await page.getByLabel('Data inicial do horário especial').fill(sunday);
  await page.getByLabel('Data final do horário especial').fill(sunday);
  await page.getByLabel('Abertura especial', { exact: true }).fill('06:00');
  await page.getByLabel('Fechamento especial', { exact: true }).fill('12:00');
  await page.getByRole('button', { name: 'Revisar horário especial', exact: true }).click();
  await confirmPreview(page);
  expect((await slots(request, 'tomaz-barber', sunday))[0]).toBe(at(sunday, '06:00'));
  expect(await slots(request, 'salao-aurora', sunday)).toEqual([]);
  const monday = add(sunday, 1);
  expect((await slots(request, 'tomaz-barber', monday))[0]).toBe(at(monday, '07:30'));
  await page.screenshot({ path: 'work/agenda-config-especiais.png', fullPage: true });
  await page.locator('.settings-tabs').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: 'work/agenda-config-especiais-mobile.png' });
  await page.setViewportSize({ width: 320, height: 844 });
  for (const tab of ['Semana', 'Horários especiais', 'Faixas e bloqueios']) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
