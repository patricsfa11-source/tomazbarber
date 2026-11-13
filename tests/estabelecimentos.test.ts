import { env } from 'cloudflare:workers';
import { SELF, reset, applyD1Migrations } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { addDays, localDate } from '../src/shared';

const base = 'https://tomaz.test';
const tomaz = 'tomaz-barber',
  aurora = 'salao-aurora';
let day = addDays(localDate(), 1);
while ([0, 1].includes(new Date(`${day}T12:00:00-03:00`).getUTCDay())) day = addDays(day, 1);
const at = (time: string, date = day) => Date.parse(`${date}T${time}:00-03:00`) / 1000;
const path = (shop: string, route: string) => `${base}/api/shops/${shop}${route}`;
const input = (name = 'Cliente Exemplo', time = '10:00') => ({
  name,
  phone: '75999990000',
  serviceId: 'corte',
  startsAt: at(time),
  requestKey: crypto.randomUUID(),
});
const get = (shop: string, route: string, cookie = '') =>
  SELF.fetch(path(shop, route), { headers: { Cookie: cookie } });
const post = (shop: string, route: string, data: unknown, cookie = '') =>
  SELF.fetch(path(shop, route), {
    method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(data),
  });
async function login(shop: string) {
  const passwords = JSON.parse(env.ADMIN_PASSWORDS!);
  const r = await post(shop, '/admin/login', { password: passwords[shop] });
  expect(r.status).toBe(200);
  expect(r.headers.get('set-cookie')).toContain(`Path=/api/shops/${shop}/admin;`);
  return r.headers.get('set-cookie')!.split(';')[0];
}
async function availability(shop: string, date = day) {
  const r = await get(shop, `/availability?date=${date}&serviceId=corte`);
  expect(r.status).toBe(200);
  return (await r.json<{ slots: number[] }>()).slots;
}
async function book(shop: string, data = input()) {
  const r = await post(shop, '/bookings', data);
  expect(r.status).toBe(201);
  return (
    await r.json<{
      appointment: { id: string; service: string; price: string; duration: number };
    }>()
  ).appointment;
}
async function customers(shop: string, cookie: string) {
  return (
    await (
      await get(shop, '/admin/customers', cookie)
    ).json<{ customers: { id: string; full_name: string; phone: string }[] }>()
  ).customers;
}

describe('catálogo, horários e reservas por estabelecimento', () => {
  it('cada link retorna a própria marca, serviços, preços e durações', async () => {
    const a = await (
      await get(tomaz, '/services')
    ).json<{
      shop: { name: string };
      services: { id: string; name: string; duration: number; price: string }[];
    }>();
    const b = await (await get(aurora, '/services')).json<typeof a>();
    expect(a.shop.name).toBe('TOMAZ BARBER');
    expect(b.shop.name).toBe('Salão Aurora');
    expect(a.services).toHaveLength(7);
    expect(b.services).toHaveLength(2);
    expect(a.services[0]).toMatchObject({ id: 'corte', name: 'Corte masculino', duration: 30 });
    expect(b.services[0]).toMatchObject({
      id: 'corte',
      name: 'Corte e finalização',
      duration: 60,
      price: 'R$ 55,00',
    });
    expect(b.services.some((s) => s.id === 'barba')).toBe(false);
  });
  it('cada link respeita o expediente próprio, inclusive fechamento na segunda', async () => {
    expect((await availability(tomaz))[0]).toBe(at('07:30'));
    expect((await availability(aurora))[0]).toBe(at('09:00'));
    expect((await availability(tomaz)).at(-1)).toBe(at('19:30'));
    expect((await availability(aurora)).at(-1)).toBe(at('17:00'));
    let monday = day;
    while (new Date(`${monday}T12:00:00-03:00`).getUTCDay() !== 1) monday = addDays(monday, 1);
    expect((await availability(tomaz, monday)).length).toBeGreaterThan(0);
    expect(await availability(aurora, monday)).toEqual([]);
    expect(
      (await post(aurora, '/bookings', { ...input(), startsAt: at('10:00', monday) })).status,
    ).toBe(400);
  });
  it('dois salões confirmam simultaneamente o mesmo horário, chave e telefone', async () => {
    const data = input();
    const [a, b] = await Promise.all([book(tomaz, data), book(aurora, data)]);
    expect(a.id).not.toBe(b.id);
    expect(a).toMatchObject({ service: 'Corte masculino', duration: 30 });
    expect(b).toMatchObject({ service: 'Corte e finalização', duration: 60, price: 'R$ 55,00' });
    const counts = await env.DB.prepare(
      'SELECT shop_id,count(*) n FROM appointments GROUP BY shop_id',
    ).all();
    expect(counts.results).toEqual([
      { shop_id: aurora, n: 1 },
      { shop_id: tomaz, n: 1 },
    ]);
    expect(
      (await env.DB.prepare('SELECT count(*) n FROM customers').first<{ n: number }>())!.n,
    ).toBe(2);
    for (const shop of [tomaz, aurora]) {
      const repeated = await post(shop, '/bookings', data);
      expect(repeated.status).toBe(200);
      expect((await repeated.json<{ appointment: { id: string } }>()).appointment.id).toBe(
        shop === tomaz ? a.id : b.id,
      );
    }
  });
  it('ocupação de um salão não remove horários do outro', async () => {
    await book(tomaz);
    expect(await availability(tomaz)).not.toContain(at('10:00'));
    expect(await availability(aurora)).toContain(at('10:00'));
    await book(aurora);
    expect(await availability(aurora)).not.toContain(at('10:30'));
    expect(await availability(tomaz)).toContain(at('10:30'));
  });
  it.each([tomaz, aurora])(
    'reservas simultâneas sobrepostas dentro de %s confirmam uma só',
    async (shop) => {
      const responses = await Promise.all([
        post(shop, '/bookings', input()),
        post(shop, '/bookings', { ...input('Outro Exemplo', '10:20'), phone: '75999990001' }),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(
        (await env.DB.prepare('SELECT count(*) n FROM appointments WHERE shop_id = ?')
          .bind(shop)
          .first<{ n: number }>())!.n,
      ).toBe(1);
      // A criação do cliente da tentativa perdedora também é desfeita pelo batch.
      expect(
        (await env.DB.prepare('SELECT count(*) n FROM customers WHERE shop_id = ?')
          .bind(shop)
          .first<{ n: number }>())!.n,
      ).toBe(1);
    },
  );
  it.each([tomaz, aurora])(
    'link e encaixe no painel de %s usam a mesma restrição',
    async (shop) => {
      const cookie = await login(shop);
      const responses = await Promise.all([
        post(shop, '/bookings', input()),
        post(shop, '/admin/bookings', input('Encaixe Exemplo', '10:20'), cookie),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    },
  );
  it('rejeita serviço de outro salão e horário fora do expediente no servidor', async () => {
    expect((await post(aurora, '/bookings', { ...input(), serviceId: 'barba' })).status).toBe(400);
    expect((await post(tomaz, '/bookings', { ...input(), serviceId: 'escova' })).status).toBe(400);
    expect((await post(aurora, '/bookings', input('Cliente Exemplo', '08:00'))).status).toBe(400);
  });
  it('ignora estabelecimento, preço e cliente forjados no corpo da reserva', async () => {
    await book(tomaz, {
      ...input(),
      shop_id: aurora,
      shopId: aurora,
      customerId: 'cliente-de-outro-salao',
      price: 'R$ 0,00',
    } as ReturnType<typeof input>);
    expect(await env.DB.prepare('SELECT shop_id,price_label FROM appointments').first()).toEqual({
      shop_id: tomaz,
      price_label: 'R$ 30,00 no Pix ou dinheiro · R$ 33,00 no cartão',
    });
  });
  it('slug desconhecido não abre nem retorna dados da TOMAZ', async () => {
    for (const route of [
      '/services',
      '/availability?date=' + day + '&serviceId=corte',
      '/admin/customers',
    ])
      expect((await get('nao-existe', route)).status).toBe(404);
    expect((await post('nao-existe', '/bookings', input())).status).toBe(404);
    expect((await SELF.fetch(`${base}/s/nao-existe`)).status).toBe(404);
  });
});

describe('isolamento de painéis, clientes e sessões', () => {
  it.each([
    [tomaz, aurora],
    [aurora, tomaz],
  ])('sessão de %s não lê nem escreve em %s, mesmo copiada manualmente', async (own, other) => {
    const cookie = await login(own);
    for (const route of [
      '/admin/session',
      '/admin/customers',
      '/admin/customers/qualquer-id',
      '/admin/bookings?date=' + day,
      '/admin/bookings/qualquer-id',
      '/admin/availability?date=' + day + '&serviceId=corte',
    ])
      expect((await get(other, route, cookie)).status).toBe(401);
    expect((await post(other, '/admin/bookings', input(), cookie)).status).toBe(401);
    expect((await post(other, '/admin/logout', {}, cookie)).status).toBe(401);
  });
  it('cada painel lista somente seus clientes e reservas, sem aceitar troca por query string', async () => {
    await book(tomaz, input('Cliente Tomaz'));
    await book(aurora, input('Cliente Aurora'));
    const a = await login(tomaz),
      b = await login(aurora);
    expect((await customers(tomaz, a)).map((c) => c.full_name)).toEqual(['Cliente Tomaz']);
    expect((await customers(aurora, b)).map((c) => c.full_name)).toEqual(['Cliente Aurora']);
    for (const [shop, cookie, name] of [
      [tomaz, a, 'Cliente Tomaz'],
      [aurora, b, 'Cliente Aurora'],
    ]) {
      const r = await get(
        shop,
        `/admin/bookings?date=${day}&shopId=${shop === tomaz ? aurora : tomaz}`,
        cookie,
      );
      expect(
        (await r.json<{ appointments: { customer_name: string }[] }>()).appointments.map(
          (x) => x.customer_name,
        ),
      ).toEqual([name]);
    }
  });
  it('IDs de clientes e reservas do outro salão retornam 404 com sessão válida própria', async () => {
    const a = await book(tomaz, input('Cliente Tomaz'));
    const b = await book(aurora, input('Cliente Aurora'));
    const ca = await login(tomaz),
      cb = await login(aurora);
    const [customerA] = await customers(tomaz, ca),
      [customerB] = await customers(aurora, cb);
    for (const [shop, cookie, foreignBooking, foreignCustomer, ownBooking, ownCustomer] of [
      [tomaz, ca, b.id, customerB.id, a.id, customerA.id],
      [aurora, cb, a.id, customerA.id, b.id, customerB.id],
    ]) {
      expect((await get(shop, `/admin/bookings/${foreignBooking}`, cookie)).status).toBe(404);
      expect((await get(shop, `/admin/customers/${foreignCustomer}`, cookie)).status).toBe(404);
      expect((await get(shop, `/admin/bookings/${ownBooking}`, cookie)).status).toBe(200);
      expect((await get(shop, `/admin/customers/${ownCustomer}`, cookie)).status).toBe(200);
    }
  });
  it('senha da TOMAZ não autentica o Aurora; logout e limite de login são independentes', async () => {
    expect((await post(aurora, '/admin/login', { password: env.ADMIN_PASSWORD })).status).toBe(401);
    const a = await login(tomaz),
      b = await login(aurora);
    expect((await post(tomaz, '/admin/logout', {}, a)).status).toBe(200);
    expect((await get(aurora, '/admin/session', b)).status).toBe(200);
    for (let i = 0; i < 9; i++)
      expect((await post(tomaz, '/admin/login', { password: 'errada' })).status).toBe(401);
    expect((await post(tomaz, '/admin/login', { password: env.ADMIN_PASSWORD })).status).toBe(429);
    expect((await get(aurora, '/admin/session', b)).status).toBe(200);
    await login(aurora);
  });
  it('rotas públicas não oferecem cadastros nem histórico de clientes', async () => {
    await book(aurora);
    expect((await get(aurora, '/customers')).status).toBe(404);
    expect((await get(aurora, '/admin/customers')).status).toBe(401);
    const response = await get(aurora, `/availability?date=${day}&serviceId=corte`);
    expect(await response.text()).not.toContain('Cliente Exemplo');
  });
  it('banco impede vincular reserva a cliente ou serviço de outro estabelecimento', async () => {
    await book(tomaz);
    const client = await env.DB.prepare('SELECT id FROM customers WHERE shop_id = ?')
      .bind(tomaz)
      .first<{ id: string }>();
    const sql =
      'INSERT INTO appointments (id,shop_id,customer_id,request_key,request_fingerprint,origin,customer_name,customer_phone,service_id,service_name,price_label,duration_minutes,starts_at,ends_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)';
    await expect(
      env.DB.prepare(sql)
        .bind(
          'foreign',
          aurora,
          client!.id,
          'foreign',
          'hash',
          'hub',
          'Cliente Exemplo',
          '+5575999990000',
          'corte',
          'Corte',
          'R$ 55,00',
          60,
          at('16:00'),
          at('17:00'),
        )
        .run(),
    ).rejects.toThrow('FOREIGN KEY constraint failed');
    await expect(
      env.DB.prepare(sql)
        .bind(
          'foreign-service',
          tomaz,
          client!.id,
          'foreign-service',
          'hash',
          'hub',
          'Cliente Exemplo',
          '+5575999990000',
          'escova',
          'Escova',
          'R$ 40,00',
          30,
          at('16:00'),
          at('16:30'),
        )
        .run(),
    ).rejects.toThrow('FOREIGN KEY constraint failed');
  });
});

it('migra reservas antigas para a TOMAZ preservando IDs, snapshots e ocupação', async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS.slice(0, 1));
  const oldInsert = env.DB.prepare(
    'INSERT INTO appointments (id,request_key,request_fingerprint,origin,customer_name,customer_phone,service_id,service_name,price_label,duration_minutes,starts_at,ends_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
  );
  await oldInsert
    .bind(
      'antiga',
      'antiga-chave',
      'antigo-hash',
      'hub',
      'Cliente Legado',
      '+5575999990000',
      'corte',
      'Nome histórico',
      'R$ 25,00',
      30,
      at('10:00'),
      at('10:30'),
    )
    .run();
  await oldInsert
    .bind(
      'antiga-2',
      'antiga-chave-2',
      'antigo-hash-2',
      'link',
      'Cliente Legado',
      '+5575999990000',
      'corte-barba',
      'Combo histórico',
      'R$ 35,00',
      40,
      at('11:00'),
      at('11:40'),
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO admin_sessions VALUES ('sessao-sem-estabelecimento',9999999999)",
  ).run();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS.slice(1));
  const migrated = await env.DB.prepare(
    'SELECT id,shop_id,service_name,price_label,request_key,request_fingerprint FROM appointments WHERE id = ?',
  )
    .bind('antiga')
    .first();
  expect(migrated).toEqual({
    id: 'antiga',
    shop_id: tomaz,
    service_name: 'Nome histórico',
    price_label: 'R$ 25,00',
    request_key: 'antiga-chave',
    request_fingerprint: 'antigo-hash',
  });
  expect(
    (await env.DB.prepare('SELECT count(*) n FROM occupied_segments WHERE shop_id = ?')
      .bind(tomaz)
      .first<{ n: number }>())!.n,
  ).toBe(7);
  expect((await env.DB.prepare('SELECT count(*) n FROM customers').first<{ n: number }>())!.n).toBe(
    1,
  );
  expect(
    (await env.DB.prepare('SELECT count(*) n FROM admin_sessions').first<{ n: number }>())!.n,
  ).toBe(0);
  expect((await post(tomaz, '/bookings', input())).status).toBe(409);
  expect((await env.DB.prepare('SELECT count(*) n FROM shops').first<{ n: number }>())!.n).toBe(1);
  await applyD1Migrations(env.DB, env.TEST_AURORA_MIGRATIONS, 'test_fixtures');
  await book(aurora);
});
