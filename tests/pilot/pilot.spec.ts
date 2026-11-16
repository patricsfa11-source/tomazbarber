import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { addDays, localDate } from '../../src/shared';

test('piloto TOMAZ: dois celulares simulados, QR, reserva, remarcação, caixa e cancelamento', async ({
  browser,
  page,
}, info) => {
  const origin = 'http://127.0.0.1:8789';
  const secrets = JSON.parse(await readFile('work/pilot-test/secrets.json', 'utf8'));
  const password = JSON.parse(secrets.ADMIN_PASSWORDS)['tomaz-barber'];
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  const response = await page.goto('/s/tomaz-barber/hub');
  expect(response!.headers()['x-tomaz-environment']).toBe('pilot');
  expect(response!.headers()['x-robots-tag']).toContain('noindex');
  const services = await (await page.request.get('/api/services')).json();
  expect(services.features.phoneVerification).toBe(false);
  await page.getByLabel('Senha do hub').fill(password);
  await page.getByRole('button', { name: 'Entrar no hub', exact: true }).click();
  await expect(page.getByLabel('Data da agenda')).toBeVisible();
  await page.getByRole('button', { name: 'Instalar hub', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Adicionar à tela inicial');
  const manifest = await (await page.request.get('/s/tomaz-barber/hub.webmanifest')).json();
  expect(manifest.start_url).toBe('/s/tomaz-barber/hub');
  expect(manifest.display).toBe('standalone');
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.getByRole('button', { name: 'Divulgar agendamento', exact: false }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar QR Code em PNG', exact: true }).click();
  const download = await downloadEvent,
    qrPath = info.outputPath('qr-local-validacao.png');
  await download.saveAs(qrPath);
  const png = PNG.sync.read(await readFile(qrPath));
  const url = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)!.data;
  expect(url).toBe(`${origin}/s/tomaz-barber`);
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  const clientContext = await browser.newContext({
    baseURL: origin,
    viewport: { width: 390, height: 844 },
    locale: 'pt-BR',
  });
  const client = await clientContext.newPage();
  client.on('request', (r) => requests.push(r.url()));
  try {
    let day = addDays(localDate(), 3);
    while (new Date(`${day}T12:00:00Z`).getUTCDay() === 0) day = addDays(day, 1);
    const at = (time: string) => Date.parse(`${day}T${time}:00-03:00`) / 1000;
    const name = 'Cliente Fictício do Piloto';
    await client.goto(url);
    await client.getByRole('button', { name: 'Agendar Corte masculino', exact: true }).click();
    await client.getByLabel('Data do atendimento').fill(day);
    await client.getByRole('button', { name: '10:00', exact: true }).click();
    await client.getByRole('button', { name: 'Continuar', exact: true }).click();
    await client.getByLabel('Nome completo', { exact: true }).fill(name);
    await client.getByLabel('Celular com DDD', { exact: true }).fill('75999990803');
    await client.getByRole('button', { name: 'Confirmar reserva', exact: true }).click();
    await expect(client.getByRole('heading', { name: 'Nos vemos em breve.' })).toBeVisible();
    const privateLink = await client
      .getByRole('link', { name: 'Consultar ou alterar esta reserva', exact: false })
      .getAttribute('href');
    await page.getByLabel('Data da agenda').fill(day);
    let card = page.locator('.appointments > li').filter({ hasText: name });
    await expect(card).toContainText('10:00');
    await page.screenshot({ path: info.outputPath('piloto-agenda-reserva.png'), fullPage: true });
    await client.goto(privateLink!);
    await client.getByRole('button', { name: 'Remarcar', exact: true }).click();
    await client.getByRole('button', { name: '11:00', exact: true }).click();
    await client.getByRole('button', { name: 'Confirmar remarcação', exact: true }).click();
    await expect(client.locator('.success-note')).toContainText('Novo horário confirmado');
    await page.getByRole('button', { name: 'Atualizar', exact: false }).click();
    card = page.locator('.appointments > li').filter({ hasText: name });
    await expect(card).toContainText('11:00');
    await expect(
      card.getByRole('button', { name: 'Concluir atendimento', exact: true }),
    ).toBeDisabled();
    await client.screenshot({
      path: info.outputPath('piloto-reserva-remarcada.png'),
      fullPage: true,
    });
    // Não enfraquecer as regras para concluir atendimento futuro: usar o histórico fictício do seed.
    const detail = await (
      await page.request.get(
        '/api/shops/tomaz-barber/admin/bookings/00000000-0000-4000-8000-00000000d101',
      )
    ).json();
    const past = localDate(new Date(detail.appointment.starts_at * 1000));
    await page.getByLabel('Data da agenda').fill(past);
    const historical = page
      .locator('.appointments > li')
      .filter({ hasText: 'João Cliente Fictício' });
    if (!detail.appointment.completed_at) {
      await historical.getByRole('button', { name: 'Concluir atendimento', exact: true }).click();
      await page.getByRole('button', { name: 'Confirmar conclusão', exact: true }).click();
    }
    await expect(historical).toContainText('Concluído');
    const baseline = await (
      await page.request.get('/api/shops/tomaz-barber/admin/receipts')
    ).json();
    const existing = await (
      await page.request.get(
        '/api/shops/tomaz-barber/admin/bookings/00000000-0000-4000-8000-00000000d101/payment',
      )
    ).json();
    await historical
      .getByRole('button', {
        name: existing.receipt ? 'Ver recebimento' : 'Registrar pagamento',
        exact: true,
      })
      .click();
    if (!existing.receipt) {
      await page.getByLabel('Valor recebido (R$)', { exact: true }).fill('30,00');
      await page.getByLabel('Data do pagamento', { exact: true }).fill(localDate());
      await page.getByRole('button', { name: 'Salvar recebimento', exact: true }).click();
    }
    await expect(page.locator('.receipt-appointment')).toContainText('Recebimento registrado');
    await page.getByRole('button', { name: 'Ver resumo do mês', exact: true }).click();
    const report = await (await page.request.get('/api/shops/tomaz-barber/admin/receipts')).json();
    if (!existing.receipt) {
      expect(report.today_cents - baseline.today_cents).toBe(3000);
      expect(report.month_cents - baseline.month_cents).toBe(3000);
    }
    expect(
      report.receipts.some(
        (r: { appointment_id: string }) => r.appointment_id === detail.appointment.id,
      ),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath('piloto-caixa.png'), fullPage: true });
    // Segunda reserva fictícia; cancelamento pelo próprio link privado devolve o intervalo.
    const input = {
      name: 'Segunda Cliente Fictícia',
      phone: '75999990804',
      serviceId: 'corte',
      startsAt: at('13:00'),
      requestKey: crypto.randomUUID(),
    };
    const secondResponse = await client.request.post('/api/shops/tomaz-barber/bookings', {
      headers: { Origin: origin },
      data: input,
    });
    expect(secondResponse.status()).toBe(201);
    const second = (await secondResponse.json()).appointment;
    await client.goto(second.manageUrl);
    await client.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await client.getByRole('button', { name: 'Confirmar cancelamento', exact: true }).click();
    await expect(client.locator('.status')).toContainText('Cancelada');
    const availability = await (
      await client.request.get(`/api/shops/tomaz-barber/availability?date=${day}&serviceId=corte`)
    ).json();
    expect(availability.slots).toContain(at('13:00'));
    expect(availability.slots).not.toContain(at('11:00'));
    expect(availability.slots).toContain(at('10:00'));
    await page.getByRole('button', { name: 'Agenda', exact: true }).click();
    await page.getByLabel('Data da agenda').fill(day);
    await page.getByRole('button', { name: 'Histórico', exact: true }).click();
    await expect(page.locator('.appointments')).toContainText('Segunda Cliente Fictícia');
    await expect(
      page.locator('.appointments > li').filter({ hasText: 'Segunda Cliente Fictícia' }),
    ).toContainText('Cancelado');
    await page.screenshot({ path: info.outputPath('piloto-cancelamento.png'), fullPage: true });
    expect(
      requests.some(
        (u) => u.includes('graph.facebook.com') || u.includes('/customer/verification'),
      ),
    ).toBe(false);
  } finally {
    await clientContext.close();
  }
});
