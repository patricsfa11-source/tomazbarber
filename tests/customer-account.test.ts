import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import worker from '../src/server';
import { addDays, localDate } from '../src/shared';
import type { CustomerBookings } from '../src/customer';
const base = 'https://tomaz.test',
  shop = 'tomaz-barber',
  phone = '75999990901',
  other = '75999990902';
const simulated = {
  ...env,
  APP_STAGE: 'pilot',
  CUSTOMER_AUTH_SECRET: 'segredo-ficticio-exclusivo-conta-cliente-12345',
  CUSTOMER_VERIFICATION_MODE: 'simulated',
  PILOT_VERIFICATION_PHONES: JSON.stringify(['+55' + phone, '+55' + other]),
};
const request = (s: string, path: string, data?: unknown, cookie = '') =>
  new Request(`${base}/api/shops/${s}${path}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
const api = (path: string, data?: unknown, cookie = '', s = shop) =>
  worker.fetch(request(s, path, data, cookie), simulated);
let day = addDays(localDate(), 6);
while ([0, 1].includes(new Date(day + 'T12:00Z').getUTCDay())) day = addDays(day, 1);
const at = (time: string) => Date.parse(day + 'T' + time + ':00-03:00') / 1000;
async function book(time: string, p = phone, s = shop) {
  const r = await api(
    '/bookings',
    {
      name: 'Cliente Convidado',
      phone: p,
      serviceId: 'corte',
      startsAt: at(time),
      requestKey: crypto.randomUUID(),
    },
    '',
    s,
  );
  expect(r.status).toBe(201);
  return (await r.json<{ appointment: { id: string } }>()).appointment.id;
}
async function verify(p = phone, s = shop) {
  const r = await api('/customer/verification', { name: 'Cliente Fictício', phone: p }, '', s);
  expect(r.status).toBe(201);
  const data = await r.json<{ challengeId: string; simulatedCode: string }>();
  expect(data.simulatedCode).toMatch(/^\d{6}$/);
  const done = await api(
    '/customer/verify',
    { challengeId: data.challengeId, code: data.simulatedCode },
    '',
    s,
  );
  expect(done.status).toBe(200);
  expect(done.headers.get('set-cookie')).toContain('Max-Age=2592000');
  return done.headers.get('set-cookie')!.split(';')[0];
}
it('vincula reservas antigas e novas ao número confirmado; separa concluídas/canceladas e outras pessoas/lojas', async () => {
  const old = await book('10:00'),
    completed = await book('11:00'),
    cancelled = await book('12:00');
  const aurora = await book('10:00', phone, 'salao-aurora'),
    stranger = await book('14:00', other);
  // Histórico fictício: o produto continua recusando concluir um atendimento futuro.
  const past = Math.floor(Date.now() / 600000) * 600 - 86400;
  await env.DB.prepare('UPDATE appointments SET starts_at=?,ends_at=?,version=version+1 WHERE id=?')
    .bind(past, past + 1800, completed)
    .run();
  await env.DB.prepare('UPDATE appointments SET completed_at=unixepoch() WHERE id=?')
    .bind(completed)
    .run();
  await env.DB.prepare(
    "UPDATE appointments SET status='cancelled',cancelled_at=unixepoch(),version=version+1 WHERE id=?",
  )
    .bind(cancelled)
    .run();
  expect((await api('/customer/bookings')).status).toBe(401);
  const cookie = await verify();
  const fresh = await book('09:00');
  const next = await (await api('/customer/bookings', undefined, cookie)).json<CustomerBookings>();
  expect(next.appointments.map((a) => a.id)).toEqual([fresh, old]);
  const history = await (
    await api('/customer/bookings?view=history', undefined, cookie)
  ).json<CustomerBookings>();
  expect(history.appointments).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: completed, status: 'completed' }),
      expect.objectContaining({ id: cancelled, status: 'cancelled' }),
    ]),
  );
  const before = await env.DB.prepare('SELECT customer_name FROM appointments WHERE id=?')
    .bind(old)
    .first('customer_name');
  expect(before).toBe('Cliente Convidado');
  const customer = await env.DB.prepare(
    'SELECT full_name FROM customers WHERE shop_id=? AND phone=?',
  )
    .bind(shop, '+55' + phone)
    .first('full_name');
  expect(customer).toBe('Cliente Fictício');
  expect((await api('/customer/session', undefined, cookie)).status).toBe(200); // sessão persiste sem outro código
  const bob = await verify(other);
  expect((await api(`/customer/bookings/${old}`, undefined, bob)).status).toBe(404);
  expect((await api(`/customer/bookings/${stranger}`, undefined, cookie)).status).toBe(404);
  expect((await api(`/customer/bookings/${aurora}`, undefined, cookie)).status).toBe(404);
  expect((await api('/customer/bookings', undefined, cookie, 'salao-aurora')).status).toBe(401);
  const auroraCookie = await verify(phone, 'salao-aurora');
  expect(
    (
      await (
        await api('/customer/bookings', undefined, auroraCookie, 'salao-aurora')
      ).json<CustomerBookings>()
    ).appointments.map((a) => a.id),
  ).toEqual([aurora]);
});
it('simula somente com piloto e números autorizados; não cadastra antes da prova nem expõe código SMS', async () => {
  expect(
    (await api('/customer/verification', { name: 'Cliente Fictício', phone: '75999990888' }))
      .status,
  ).toBe(400);
  expect((await api('/customer/verification', { name: '', phone })).status).toBe(400);
  expect(await env.DB.prepare('SELECT count(*) n FROM customers').first('n')).toBe(0);
  const r = await worker.fetch(
    request(shop, '/customer/verification', { name: 'Cliente Fictício', phone }),
    { ...simulated, APP_STAGE: 'production' },
  );
  expect(r.status).toBe(503);
  let channel = '';
  const sms = await worker.fetch(
    request(shop, '/customer/verification', { name: 'Cliente Fictício', phone }),
    {
      ...simulated,
      CUSTOMER_VERIFICATION_MODE: 'sms',
      VERIFICATION_SENDER: {
        async fetch(r: Request) {
          const data = await r.json<{ channel: string; phone: string }>();
          channel = data.channel;
          expect(data.phone).toBe('+55' + phone);
          return Response.json({ accepted: true });
        },
      } as Fetcher,
    },
  );
  expect(sms.status).toBe(201);
  expect(channel).toBe('sms');
  expect(await sms.json()).not.toHaveProperty('simulatedCode');
  expect(await env.DB.prepare('SELECT count(*) n FROM customers').first('n')).toBe(0);
});
