import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { addDays, localDate } from '../../src/shared';
const origin = 'http://127.0.0.1:8788',
  today = localDate(),
  day = addDays(today, -5);
const api = (r: APIRequestContext, shop: string, path: string, data?: unknown) =>
  r.fetch(`/api/shops/${shop}${path}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { Origin: origin },
    data,
  });
// Registros históricos fictícios: o formulário público continua impedindo reservas no passado.
function historical(shop: string, name: string, phone: string, time = '10:00') {
  const id = crypto.randomUUID(),
    customer = crypto.randomUUID(),
    start = Date.parse(`${day}T${time}:00-03:00`) / 1000;
  const sql = `INSERT INTO customers(shop_id,id,full_name,phone) VALUES ('${shop}','${customer}','${name}','${phone}');
    INSERT INTO appointments(id,shop_id,professional_id,customer_id,request_key,request_fingerprint,origin,customer_name,customer_phone,service_id,service_name,price_label,duration_minutes,starts_at,ends_at,booking_channel,schedule_revision)
    SELECT '${id}',s.shop_id,'principal','${customer}','${crypto.randomUUID()}','fixture-historica','hub','${name}','${phone}',s.id,s.name,s.price,s.duration,${start},${start}+s.duration*60,'hub',c.revision FROM services s JOIN schedule_settings c ON c.shop_id=s.shop_id AND c.professional_id='principal' WHERE s.shop_id='${shop}' AND s.id='corte';`;
  execFileSync(
    'node_modules/.bin/wrangler',
    ['d1', 'execute', 'tomazbarber-dev', '--local', '--persist-to', 'work/e2e', '--command', sql],
    { stdio: 'pipe', env: process.env },
  );
  return id;
}
async function login(page: Page, shop = 'tomaz-barber') {
  await page.goto(`/s/${shop}/hub`);
  await page
    .getByLabel('Senha do hub')
    .fill(
      shop === 'tomaz-barber' ? 'senha-ficticia-e2e-local-123' : 'senha-ficticia-aurora-e2e-123',
    );
  await page.getByRole('button', { name: 'Entrar no hub', exact: true }).click();
  await expect(page.getByLabel('Data da agenda')).toBeVisible();
}
const fits = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
test('celular conclui sem cobrar, registra recebimento separado e consulta mês dos dois salões', async ({
  page,
}, info) => {
  const calls: string[] = [];
  page.on('request', (r) => calls.push(r.url()));
  for (const shop of ['tomaz-barber', 'salao-aurora']) {
    const name = shop === 'tomaz-barber' ? 'Carlos Cliente Fictício' : 'Beatriz Cliente Fictícia';
    const id = historical(
      shop,
      name,
      shop === 'tomaz-barber' ? '+5575999990710' : '+5575999990711',
    );
    await login(page, shop);
    await page.getByLabel('Data da agenda').fill(day);
    let card = page.locator('.appointments > li').filter({ hasText: name });
    await expect(card).toContainText('Sem recebimento registrado');
    await card.getByRole('button', { name: 'Concluir atendimento', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Concluir atendimento.' })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`concluir-${shop}-mobile.png`), fullPage: true });
    await page.getByRole('button', { name: 'Confirmar conclusão', exact: true }).click();
    card = page.locator('.appointments > li').filter({ hasText: name });
    await expect(card).toContainText('Concluído');
    await expect(card).toContainText('Sem recebimento registrado');
    const before = await (await api(page.request, shop, '/admin/receipts')).json();
    expect(before.total_cents).toBe(0);
    await page.screenshot({
      path: info.outputPath(`concluido-${shop}-mobile.png`),
      fullPage: true,
    });
    await card.getByRole('button', { name: 'Registrar pagamento', exact: true }).click();
    await expect(page.getByLabel('Valor recebido (R$)', { exact: true })).toHaveValue(
      shop === 'tomaz-barber' ? '30,00' : '55,00',
    );
    await page.getByLabel('Forma de pagamento', { exact: true }).selectOption('card');
    await expect(page.getByLabel('Valor recebido (R$)', { exact: true })).toHaveValue(
      shop === 'tomaz-barber' ? '33,00' : '55,00',
    );
    await page
      .getByLabel('Valor recebido (R$)', { exact: true })
      .fill(shop === 'tomaz-barber' ? '32,50' : '57,00');
    await page.screenshot({
      path: info.outputPath(`pagamento-${shop}-mobile.png`),
      fullPage: true,
    });
    await page.locator('#receipt-payment').evaluate((form: HTMLFormElement) => {
      form.requestSubmit();
      form.requestSubmit();
    });
    await expect(page.locator('.receipt-appointment')).toContainText('Recebimento registrado');
    const summary = await (await api(page.request, shop, '/admin/receipts')).json();
    expect(summary.count).toBe(1);
    expect(summary.total_cents).toBe(shop === 'tomaz-barber' ? 3250 : 5700);
    await page.getByRole('button', { name: 'Ver resumo do mês', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Recebimentos e relatórios.' })).toBeVisible();
    await expect(page.locator('.receipt-groups')).toContainText(name);
    await expect(page.locator('.receipt-groups')).not.toContainText(
      shop === 'tomaz-barber' ? 'Beatriz Cliente Fictícia' : 'Carlos Cliente Fictício',
    );
    await page.screenshot({ path: info.outputPath(`resumo-${shop}-mobile.png`), fullPage: true });
    await page.getByRole('button', { name: 'Por serviço', exact: true }).click();
    await expect(page.locator('.receipt-groups')).toContainText(
      shop === 'tomaz-barber' ? 'Corte masculino' : 'Corte e finalização',
    );
    await page.getByRole('button', { name: 'Por pagamento', exact: true }).click();
    await expect(page.locator('.receipt-groups')).toContainText('Cartão');
    await fits(page);
    await page.setViewportSize({ width: 320, height: 740 });
    await fits(page);
    await page.setViewportSize({ width: 390, height: 844 });
    expect((await api(page.request, shop, `/admin/bookings/${id}/payment`)).status()).toBe(200);
  }
  expect(calls.some((url) => url.includes('graph.facebook.com'))).toBe(false);
});
test('salva recebimento após perda da resposta sem duplicar; data do pagamento filtra o caixa', async ({
  page,
}) => {
  const shop = 'tomaz-barber',
    name = 'Denise Cliente Fictícia',
    id = historical(shop, name, '+5575999990712', '12:00'),
    paidOn = addDays(today, -1);
  await login(page);
  await page.getByLabel('Data da agenda').fill(day);
  await page
    .locator('.appointments > li')
    .filter({ hasText: name })
    .getByRole('button', { name: 'Registrar pagamento', exact: true })
    .click();
  await page.getByLabel('Data do pagamento', { exact: true }).fill(paidOn);
  await page.getByLabel('Forma de pagamento', { exact: true }).selectOption('cash');
  await page.getByLabel('Valor recebido (R$)', { exact: true }).fill('28,75');
  let lost = false;
  await page.route(`**/api/shops/${shop}/admin/bookings/${id}/payment`, async (route) => {
    if (route.request().method() === 'POST' && !lost) {
      lost = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Salvar recebimento', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Não foi possível confirmar a resposta');
  await expect(page.getByLabel('Valor recebido (R$)', { exact: true })).toHaveValue('28,75');
  await page.getByRole('button', { name: 'Salvar recebimento', exact: true }).click();
  await expect(page.locator('.receipt-appointment')).toContainText('Recebimento registrado');
  const detail = await (await api(page.request, shop, `/admin/bookings/${id}/payment`)).json();
  expect(detail.appointment.completed_at).toBeNull();
  await page.getByRole('button', { name: 'Ver resumo do mês', exact: true }).click();
  await page.getByLabel('De', { exact: true }).fill(paidOn);
  await page.getByLabel('Até', { exact: true }).fill(paidOn);
  await page.getByRole('button', { name: 'Aplicar período', exact: true }).click();
  await expect(page.locator('.cash-total')).toHaveText(/28,75/);
  await expect(page.locator('.receipt-groups')).toContainText(name);
  expect(
    (await (await api(page.request, shop, `/admin/receipts?from=${paidOn}&to=${paidOn}`)).json())
      .count,
  ).toBe(1);
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await expect(page.getByLabel('Data da agenda')).toBeVisible();
});
