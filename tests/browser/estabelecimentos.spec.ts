import { test, expect, type Page } from '@playwright/test';

let day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bahia' }).format(
  new Date(Date.now() + 86400000),
);
while ([0, 1].includes(new Date(`${day}T12:00:00-03:00`).getUTCDay()))
  day = new Date(Date.parse(`${day}T12:00:00-03:00`) + 86400000).toISOString().slice(0, 10);
async function finish(page: Page, name: string, phone: string) {
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByLabel('Nome completo').fill(name);
  await page.getByLabel('Celular com DDD').fill(phone);
  await page.getByRole('button', { name: /Confirmar (reserva|encaixe)/ }).click();
  await expect(
    page.getByRole('heading', { name: /Nos vemos em breve|Encaixe confirmado/ }),
  ).toBeVisible();
}
async function login(page: Page, slug: string, password: string) {
  await page.goto(`/s/${slug}/hub`);
  await page.getByLabel('Senha do hub').fill(password);
  await page.getByRole('button', { name: 'Entrar no hub' }).click();
  await page.getByLabel('Data da agenda').waitFor();
  await page.getByLabel('Data da agenda').fill(day);
}
test('links próprios preservam a TOMAZ, mostram catálogos e horários certos e confirmam o mesmo horário', async ({
  page,
}) => {
  for (const shop of [
    {
      slug: 'tomaz-barber',
      name: 'TOMAZ BARBER',
      service: 'Corte masculino',
      count: 7,
      price: 'R$ 30,00',
      duration: 30,
      first: '07:30',
      customer: 'Reserva Link Tomaz',
      phone: '75999990111',
    },
    {
      slug: 'salao-aurora',
      name: 'Salão Aurora',
      service: 'Corte e finalização',
      count: 2,
      price: 'R$ 55,00',
      duration: 60,
      first: '09:00',
      customer: 'Reserva Link Aurora',
      phone: '75999990112',
    },
  ]) {
    await page.goto(`/s/${shop.slug}`);
    await expect(page.getByRole('heading', { name: shop.name, exact: true })).toBeVisible();
    await expect(page).toHaveTitle(`${shop.name} · Seu próximo horário`);
    await expect(page.locator('[data-public-service]')).toHaveCount(shop.count);
    if (shop.slug === 'tomaz-barber') {
      await expect(page.locator('.shop-cover img')).toBeVisible();
      await expect
        .poll(() =>
          page
            .locator('.shop-cover img')
            .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
        )
        .toBe(true);
    } else await expect(page.getByText('Corte masculino', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: `work/${shop.slug}-publico.png`, fullPage: true });
    await page.getByRole('button', { name: `Agendar ${shop.service}`, exact: true }).click();
    await page.getByLabel('Data do atendimento').fill(day);
    await expect(page.getByRole('button', { name: shop.first, exact: true })).toBeVisible();
    if (shop.slug === 'salao-aurora')
      await expect(page.getByRole('button', { name: '07:30', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '15:00', exact: true }).click();
    await finish(page, shop.customer, shop.phone);
    await expect(page.getByText(shop.service, { exact: true })).toBeVisible();
    await expect(page.locator('.confirmed-details')).toContainText(shop.price);
    await expect(page.locator('.confirmed-details')).toContainText(`${shop.duration} minutos`);
    await expect(
      page.getByText(`Seu horário está reservado em ${shop.name}.`, { exact: true }),
    ).toBeVisible();
  }
});
test('dois painéis no mesmo navegador mantêm sessões e clientes isolados; encaixe do Aurora ocupa apenas seu link', async ({
  page,
  context,
  request,
}) => {
  for (const [slug, name, phone] of [
    ['tomaz-barber', 'Cliente Multi Tomaz', '75999990121'],
    ['salao-aurora', 'Cliente Multi Aurora', '75999990122'],
  ]) {
    const response = await request.post(`/api/shops/${slug}/bookings`, {
      headers: { Origin: 'http://127.0.0.1:8788' },
      data: {
        name,
        phone,
        serviceId: 'corte',
        startsAt: Date.parse(`${day}T12:00:00-03:00`) / 1000,
        requestKey: crypto.randomUUID(),
      },
    });
    expect(response.status()).toBe(201);
  }
  const aurora = await context.newPage();
  await login(page, 'tomaz-barber', 'senha-ficticia-e2e-local-123');
  await login(aurora, 'salao-aurora', 'senha-ficticia-aurora-e2e-123');
  await page.reload();
  await aurora.reload();
  for (const [panel, slug, own, foreign] of [
    [page, 'tomaz-barber', 'Cliente Multi Tomaz', 'Cliente Multi Aurora'],
    [aurora, 'salao-aurora', 'Cliente Multi Aurora', 'Cliente Multi Tomaz'],
  ] as const) {
    await panel.getByLabel('Data da agenda').fill(day);
    await expect(panel.getByRole('heading', { name: own, exact: true })).toBeVisible();
    await expect(panel.getByRole('heading', { name: foreign, exact: true })).toHaveCount(0);
    await panel.getByRole('button', { name: 'Clientes', exact: true }).click();
    await expect(panel.getByRole('heading', { name: own, exact: true })).toBeVisible();
    await expect(panel.getByRole('heading', { name: foreign, exact: true })).toHaveCount(0);
    await panel.screenshot({ path: `work/${slug}-clientes.png`, fullPage: true });
    await panel.getByRole('button', { name: 'Agenda', exact: true }).click();
  }
  await aurora.getByRole('button', { name: 'Novo encaixe' }).click();
  await aurora.getByRole('radio', { name: /Escova/ }).click();
  await aurora.getByRole('button', { name: 'Escolher horário' }).click();
  await aurora.getByLabel('Data do atendimento').fill(day);
  await aurora.getByRole('button', { name: '16:00', exact: true }).click();
  await finish(aurora, 'Encaixe Aurora', '75999990113');
  await aurora.getByRole('button', { name: 'Voltar à agenda' }).click();
  await expect(aurora.getByRole('heading', { name: 'Encaixe Aurora' })).toBeVisible();
  await aurora.screenshot({ path: 'work/salao-aurora-hub.png', fullPage: true });
  await page.getByRole('button', { name: 'Sair do hub' }).click();
  await expect(page.getByLabel('Senha do hub')).toBeVisible();
  await aurora.reload();
  await expect(aurora.getByLabel('Data da agenda')).toBeVisible();
  const publicPage = await context.newPage();
  await publicPage.goto('/s/salao-aurora');
  await publicPage.getByRole('button', { name: 'Agendar Escova', exact: true }).click();
  await publicPage.getByLabel('Data do atendimento').fill(day);
  await expect(publicPage.getByRole('button', { name: '16:30', exact: true })).toBeVisible();
  await expect(publicPage.getByRole('button', { name: '16:00', exact: true })).toHaveCount(0);
  await publicPage.goto('/s/tomaz-barber');
  await publicPage.getByRole('button', { name: 'Agendar Corte masculino', exact: true }).click();
  await publicPage.getByLabel('Data do atendimento').fill(day);
  await expect(publicPage.getByRole('button', { name: '16:00', exact: true })).toBeVisible();
});
test('os dois estabelecimentos cabem no celular de 320px e não reaproveitam uma marca incorreta', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  for (const slug of ['tomaz-barber', 'salao-aurora']) {
    for (const suffix of ['', '/hub']) {
      await page.goto(`/s/${slug}${suffix}`);
      if (suffix) await expect(page.getByLabel('Senha do hub')).toBeVisible();
      else await expect(page.getByRole('searchbox', { name: 'Pesquisar serviço' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  }
});
