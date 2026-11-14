import { test, expect, type APIRequestContext } from '@playwright/test';
import { addDays, localDate } from '../../src/shared';
import { hmac } from '../../src/server/whatsapp/meta';
const origin = 'http://127.0.0.1:8788',
  root = '/api/shops/tomaz-barber',
  auth = { Authorization: 'Bearer chave-ficticia-exclusiva-do-remetente-e2e' };
let day = addDays(localDate(), 42);
while ([0, 1].includes(new Date(`${day}T12:00:00Z`).getUTCDay())) day = addDays(day, 1);
const api = (r: APIRequestContext, path: string, data?: unknown) =>
  r.fetch(root + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { Origin: origin },
    data,
  });
test('hub confere teste Meta, confirma link e encaixe, recupera rejeição e recebe entrega no celular', async ({
  page,
  request,
}, info) => {
  await page.goto('/s/tomaz-barber/hub');
  await page.getByLabel('Senha do hub').fill('senha-ficticia-e2e-local-123');
  await page.getByRole('button', { name: 'Entrar no hub' }).click();
  await expect(page.getByLabel('Data da agenda')).toBeVisible();
  await page.getByRole('button', { name: 'WhatsApp', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Vamos conferir a conexão?' })).toBeVisible();
  await expect(
    page.getByText('Nesta etapa, as mensagens vão somente para', { exact: false }),
  ).toContainText('0500');
  await page.getByRole('button', { name: 'Conferir destinatário', exact: true }).click();
  await page.getByRole('button', { name: 'Enviar teste', exact: true }).click();
  await expect(page.locator('.wa-deliveries')).toContainText('Aceita pela Meta');
  async function book(time: string, manual = false) {
    const r = await api(manual ? page.request : request, manual ? '/admin/bookings' : '/bookings', {
      name: 'Cliente WhatsApp Fictício',
      phone: '75999990500',
      serviceId: 'corte',
      startsAt: Date.parse(`${day}T${time}:00-03:00`) / 1000,
      requestKey: crypto.randomUUID(),
    });
    expect(r.status()).toBe(201);
    return (await r.json()).appointment.id as string;
  }
  await book('10:00');
  await book('11:00', true);
  await expect
    .poll(async () => {
      const d = await (await api(page.request, '/admin/whatsapp')).json();
      return d.deliveries.filter(
        (x: { kind: string; state: string }) => x.kind === 'confirmation' && x.state === 'accepted',
      ).length;
    })
    .toBe(2);
  expect(
    (
      await request.post('http://127.0.0.1:8790/meta-control', {
        headers: auth,
        data: { status: 400 },
      })
    ).status(),
  ).toBe(200);
  const failedId = await book('12:00');
  await expect
    .poll(async () => {
      const d = await (await api(page.request, '/admin/whatsapp')).json();
      return d.deliveries.find((x: { appointment_id: string }) => x.appointment_id === failedId)
        ?.state;
    })
    .toBe('failed');
  await page.getByRole('button', { name: 'Atualizar ↻', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Falha identificada', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect
    .poll(async () => {
      const d = await (await api(page.request, '/admin/whatsapp')).json();
      return d.deliveries.find((x: { appointment_id: string }) => x.appointment_id === failedId)
        ?.state;
    })
    .toBe('accepted');
  const meta = (await (
    await request.get('http://127.0.0.1:8790/meta-messages', { headers: auth })
  ).json()) as {
    payload: { biz_opaque_callback_data: string };
    providerId: string | null;
    status: number;
  }[];
  const accepted = meta.find((m) => m.status === 200 && m.payload.biz_opaque_callback_data)!;
  const body = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '222222222222',
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: '111111111111' },
              statuses: [
                {
                  id: accepted.providerId,
                  status: 'delivered',
                  recipient_id: '5575999990500',
                  timestamp: '1790000000',
                  biz_opaque_callback_data: accepted.payload.biz_opaque_callback_data,
                },
              ],
            },
          },
        ],
      },
    ],
  });
  const sig = await hmac('app-secret-ficticio-exclusivo-e2e-123', new TextEncoder().encode(body));
  for (let n = 0; n < 2; n++)
    expect(
      (
        await request.post('/webhooks/whatsapp', {
          headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': `sha256=${sig}` },
          data: body,
        })
      ).status(),
    ).toBe(200);
  await page.getByRole('button', { name: 'Atualizar ↻', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Entregue', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('whatsapp-hub-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('whatsapp-hub-320.png'), fullPage: true });
});
