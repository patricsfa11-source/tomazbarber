import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { addDays, localDate, type ManagedService } from '../src/shared';
const base = 'https://tomaz.test',
  shop = 'tomaz-barber';
const path = (s: string, p: string) => `/api/shops/${s}${p}`;
const get = (p: string, cookie = '') => SELF.fetch(base + p, { headers: { Cookie: cookie } });
const post = (p: string, data: unknown, cookie = '') =>
  SELF.fetch(base + p, {
    method: 'POST',
    headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
async function login(s = shop) {
  const r = await post(path(s, '/admin/login'), {
    password: s === shop ? env.ADMIN_PASSWORD : 'senha-ficticia-aurora-testes-456',
  });
  expect(r.status).toBe(200);
  return r.headers.get('set-cookie')!.split(';')[0];
}
async function catalog(cookie: string, s = shop) {
  return (
    await (await get(path(s, '/admin/services'), cookie)).json<{ services: ManagedService[] }>()
  ).services;
}
const edit = (s: ManagedService, changes: Partial<ManagedService> = {}) => ({
  ...s,
  ...changes,
  expectedVersion: s.version,
});
let day = addDays(localDate(), 10);
while (new Date(day + 'T12:00Z').getUTCDay() === 0) day = addDays(day, 1);
const at = (time: string) => Date.parse(`${day}T${time}:00-03:00`) / 1000;
it('protege o catálogo de gestão e não permite editar serviços de outra loja', async () => {
  expect((await get(path(shop, '/admin/services'))).status).toBe(401);
  const cookie = await login(),
    aurora = await login('salao-aurora');
  expect((await get(path('salao-aurora', '/admin/services'), cookie)).status).toBe(401);
  const service = (await catalog(aurora, 'salao-aurora'))[0];
  expect(
    (await post(path('salao-aurora', '/admin/services/corte'), edit(service), cookie)).status,
  ).toBe(401);
  const before = await catalog(aurora, 'salao-aurora'),
    corte = (await catalog(cookie))[0];
  expect(
    (await post(path(shop, '/admin/services/corte'), edit(corte, { name: 'Novo Corte' }), cookie))
      .status,
  ).toBe(200);
  expect(await catalog(aurora, 'salao-aurora')).toEqual(before);
  expect((await post(path(shop, '/admin/services/inexistente'), edit(corte), cookie)).status).toBe(
    404,
  );
});
it('valida limites e impede sobrescrever uma edição concorrente', async () => {
  const cookie = await login(),
    service = (await catalog(cookie))[0];
  for (const invalid of [
    { duration: 15 },
    { duration: 0 },
    { duration: 250 },
    { name: '' },
    { price: '' },
    { active: 'sim' },
    { paymentConditions: 'x'.repeat(301) },
    { expectedVersion: 0 },
  ])
    expect(
      (await post(path(shop, '/admin/services/corte'), { ...edit(service), ...invalid }, cookie))
        .status,
    ).toBe(400);
  expect(
    (await post(path(shop, '/admin/services/corte'), edit(service, { duration: 50 }), cookie))
      .status,
  ).toBe(200);
  expect(
    (
      await post(
        path(shop, '/admin/services/corte'),
        edit(service, { name: 'Edição atrasada' }),
        cookie,
      )
    ).status,
  ).toBe(409);
  expect((await catalog(cookie))[0].duration).toBe(50);
});
it('cadastra e publica um novo serviço, desativa e reativa nos dois canais', async () => {
  const cookie = await login();
  const r = await post(
    path(shop, '/admin/services'),
    {
      name: 'Cuidado especial',
      duration: 50,
      price: 'A partir de R$ 50,00',
      paymentConditions: 'Pix ou cartão',
      description: 'Cuidado completo',
      active: true,
    },
    cookie,
  );
  expect(r.status).toBe(201);
  let s = (await r.json<{ service: ManagedService }>()).service;
  const pub = await (
    await get(path(shop, '/services'))
  ).json<{ services: { id: string; price: string }[] }>();
  expect(pub.services.find((x) => x.id === s.id)?.price).toBe(
    'A partir de R$ 50,00 · Pix ou cartão',
  );
  const availability = await (
    await get(path(shop, `/availability?date=${day}&serviceId=${s.id}`))
  ).json<{ slots: number[] }>();
  expect(availability.slots.slice(0, 3)).toEqual([at('07:30'), at('08:20'), at('09:10')]);
  s = (
    await (
      await post(path(shop, '/admin/services/' + s.id), edit(s, { active: false }), cookie)
    ).json<{ service: ManagedService }>()
  ).service;
  expect((await get(path(shop, `/availability?date=${day}&serviceId=${s.id}`))).status).toBe(400);
  for (const channel of ['/bookings', '/admin/bookings'])
    expect(
      (
        await post(
          path(shop, channel),
          {
            name: 'Cliente Fictício',
            phone: '75999990471',
            serviceId: s.id,
            startsAt: at('10:00'),
            requestKey: crypto.randomUUID(),
          },
          cookie,
        )
      ).status,
    ).toBe(400);
  expect((await catalog(cookie)).find((x) => x.id === s.id)?.active).toBe(false);
  expect(
    (await post(path(shop, '/admin/services/' + s.id), edit(s, { active: true }), cookie)).status,
  ).toBe(200);
  expect((await get(path(shop, `/availability?date=${day}&serviceId=${s.id}`))).status).toBe(200);
});
it('edição e desativação preservam todas as condições da reserva antiga, inclusive na remarcação', async () => {
  const cookie = await login(),
    s = (await catalog(cookie))[0];
  const data = {
    name: 'Cliente Fictício',
    phone: '75999990472',
    serviceId: s.id,
    startsAt: at('10:00'),
    requestKey: crypto.randomUUID(),
  };
  const b = (
    await (await post(path(shop, '/bookings'), data)).json<{ appointment: { id: string } }>()
  ).appointment;
  const detail = async () =>
    (
      await (
        await get(path(shop, `/admin/bookings/${b.id}`), cookie)
      ).json<{ appointment: Record<string, unknown> }>()
    ).appointment;
  const before = await detail();
  await post(
    path(shop, '/admin/services/' + s.id),
    edit(s, {
      name: 'Corte atualizado',
      duration: 50,
      price: 'R$ 50,00',
      paymentConditions: 'Somente Pix',
    }),
    cookie,
  );
  const newData = { ...data, startsAt: at('14:00'), requestKey: crypto.randomUUID() };
  const next = await (
    await post(path(shop, '/bookings'), newData)
  ).json<{ appointment: { price: string; duration: number; service: string } }>();
  expect(next.appointment).toMatchObject({
    price: 'R$ 50,00 · Somente Pix',
    duration: 50,
    service: 'Corte atualizado',
  });
  const updated = (await catalog(cookie))[0];
  await post(path(shop, '/admin/services/' + s.id), edit(updated, { active: false }), cookie);
  expect(await detail()).toEqual(before);
  const moved = await post(
    path(shop, `/admin/bookings/${b.id}/reschedule`),
    { expectedVersion: 1, requestKey: crypto.randomUUID(), startsAt: at('11:00') },
    cookie,
  );
  expect(moved.status).toBe(200);
  expect(await detail()).toMatchObject({
    service_name: before.service_name,
    price_label: before.price_label,
    duration_minutes: 30,
    starts_at: at('11:00'),
    ends_at: at('11:30'),
  });
  expect((await post(path(shop, '/bookings'), data)).status).toBe(200); // repetição idempotente mantém a reserva
  expect(
    (
      await post(
        path(shop, `/admin/bookings/${b.id}/cancel`),
        { expectedVersion: 2, requestKey: crypto.randomUUID() },
        cookie,
      )
    ).status,
  ).toBe(200);
});
