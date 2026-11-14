import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/server';
import { addDays, localDate } from '../src/shared';
import type { CustomerBookings, CustomerBooking } from '../src/customer';
const base = 'https://tomaz.test',
  tomaz = 'tomaz-barber',
  aurora = 'salao-aurora';
const alice = '75999991111',
  bob = '75999992222';
let day = addDays(localDate(), 3);
while ([0, 1].includes(new Date(`${day}T12:00:00Z`).getUTCDay())) day = addDays(day, 1);
const at = (time: string) => Date.parse(`${day}T${time}:00-03:00`) / 1000;
type Message = { challengeId: string; shopId: string; phone: string; code: string };
let messages: Message[] = [];
const sender = {
  async fetch(request: Request) {
    messages.push(await request.json<Message>());
    return Response.json({ accepted: true });
  },
} as unknown as Fetcher;
const testEnv = () => ({
  ...env,
  CUSTOMER_AUTH_SECRET: 'segredo-ficticio-exclusivo-dos-testes-de-cliente-123',
  VERIFICATION_SENDER: sender,
});
function request(shop: string, path: string, data?: unknown, cookie = '') {
  return new Request(`${base}/api/shops/${shop}${path}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json', Cookie: cookie },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
}
const api = (shop: string, path: string, data?: unknown, cookie = '') =>
  worker.fetch(request(shop, path, data, cookie), testEnv());
async function book(shop = tomaz, phone = alice, time = '10:00', manual = false) {
  let cookie = '';
  if (manual) {
    const r = await SELF.fetch(
      request(shop, '/admin/login', { password: JSON.parse(env.ADMIN_PASSWORDS!)[shop] }),
    );
    cookie = r.headers.get('Set-Cookie')!.split(';')[0];
  }
  const r = await SELF.fetch(
    request(
      shop,
      manual ? '/admin/bookings' : '/bookings',
      {
        name: phone === alice ? 'Alice Cliente' : 'Bruno Cliente',
        phone,
        serviceId: 'corte',
        startsAt: at(time),
        requestKey: crypto.randomUUID(),
      },
      cookie,
    ),
  );
  expect(r.status).toBe(201);
  return (await r.json<{ appointment: { id: string } }>()).appointment.id;
}
async function challenge(shop = tomaz, phone = alice) {
  const r = await api(shop, '/customer/verification', { phone });
  expect(r.status).toBe(201);
  const data = await r.json<{ challengeId: string; maskedPhone: string }>();
  const message = messages.find((m) => m.challengeId === data.challengeId)!;
  expect(message).toBeTruthy();
  return { ...data, code: message.code };
}
async function verify(shop = tomaz, phone = alice) {
  const data = await challenge(shop, phone);
  const r = await api(shop, '/customer/verify', { challengeId: data.challengeId, code: data.code });
  expect(r.status).toBe(200);
  return r.headers.get('Set-Cookie')!.split(';')[0];
}
const action = (version = 1, startsAt?: number, key = crypto.randomUUID()) => ({
  expectedVersion: version,
  requestKey: key,
  ...(startsAt !== undefined ? { startsAt } : {}),
});
const change = (id: string, kind: string, data: unknown, cookie: string, shop = tomaz) =>
  api(shop, `/customer/bookings/${id}/${kind}`, data, cookie);
async function detail(id: string, cookie: string, shop = tomaz) {
  const r = await api(shop, `/customer/bookings/${id}`, undefined, cookie);
  expect(r.status).toBe(200);
  return (await r.json<{ appointment: CustomerBooking }>()).appointment;
}
async function segments(id: string) {
  return (
    await env.DB.prepare(
      'SELECT starts_at FROM occupied_segments WHERE appointment_id=? ORDER BY starts_at',
    )
      .bind(id)
      .all()
  ).results;
}
beforeEach(() => {
  messages = [];
});

describe('código pelo WhatsApp e sessão do cliente', () => {
  it('envia código só ao remetente e não revela se o celular possui reservas', async () => {
    await book();
    const first = await challenge();
    expect(first.code).toMatch(/^\d{6}$/);
    const r = await api(aurora, '/customer/verification', { phone: bob });
    expect(r.status).toBe(201);
    const response = await r.json<Record<string, unknown>>();
    expect(Object.keys(response).sort()).toEqual([
      'challengeId',
      'expiresAt',
      'maskedPhone',
      'resendAfter',
    ]);
    expect(response).not.toHaveProperty('code');
    expect(response).not.toHaveProperty('customerId');
    const stored = await env.DB.prepare('SELECT code_hash FROM phone_challenges WHERE id=?')
      .bind(first.challengeId)
      .first<{ code_hash: string }>();
    expect(stored!.code_hash).not.toBe(first.code);
    expect(stored!.code_hash).toHaveLength(64);
    expect(
      await env.DB.prepare('SELECT count(*) AS n FROM customers WHERE shop_id=?')
        .bind(aurora)
        .first('n'),
    ).toBe(0);
  });
  it('aceita código uma única vez e cria cookie privado com escopo e expiração', async () => {
    const d = await challenge();
    const r = await api(tomaz, '/customer/verify', d);
    expect(r.status).toBe(200);
    const cookie = r.headers.get('Set-Cookie')!;
    for (const part of [
      'HttpOnly',
      'SameSite=Strict',
      'Secure',
      'Path=/api/shops/tomaz-barber/customer',
      'Max-Age=86400',
    ])
      expect(cookie).toContain(part);
    const session = cookie.split(';')[0];
    expect((await api(tomaz, '/customer/session', undefined, session)).status).toBe(200);
    expect((await api(tomaz, '/customer/verify', d)).status).toBe(400);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM customer_sessions').first('n')).toBe(1);
    expect((await api(tomaz, '/admin/session', undefined, session)).status).toBe(401);
  });
  it('recusa código incorreto e encerra o desafio após cinco tentativas', async () => {
    const d = await challenge(),
      wrong = d.code === '000000' ? '111111' : '000000';
    for (let n = 0; n < 5; n++)
      expect((await api(tomaz, '/customer/verify', { ...d, code: wrong })).status).toBe(400);
    expect((await api(tomaz, '/customer/verify', d)).status).toBe(400);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM customer_sessions').first('n')).toBe(0);
  });
  it('recusa código expirado, de outro salão e desafio inexistente sem liberar dados', async () => {
    const d = await challenge();
    expect((await api(aurora, '/customer/verify', d)).status).toBe(400);
    await env.DB.prepare('UPDATE phone_challenges SET expires_at=unixepoch()-1 WHERE id=?')
      .bind(d.challengeId)
      .run();
    expect((await api(tomaz, '/customer/verify', d)).status).toBe(400);
    expect(
      (await api(tomaz, '/customer/verify', { ...d, challengeId: crypto.randomUUID() })).status,
    ).toBe(400);
  });
  it('duas verificações simultâneas geram somente uma sessão', async () => {
    const d = await challenge();
    const rs = await Promise.all([
      api(tomaz, '/customer/verify', d),
      api(tomaz, '/customer/verify', d),
    ]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM customer_sessions').first('n')).toBe(1);
  });
  it('exige intervalo de reenvio e invalida o código anterior ao reenviar', async () => {
    const d = await challenge();
    expect((await api(tomaz, '/customer/verification', { phone: alice })).status).toBe(429);
    expect(messages).toHaveLength(1);
    await env.DB.prepare('UPDATE phone_challenges SET created_at=unixepoch()-61').run();
    const next = await challenge();
    expect((await api(tomaz, '/customer/verify', d)).status).toBe(400);
    expect((await api(tomaz, '/customer/verify', next)).status).toBe(200);
  });
  it('limita envios por telefone e IP sem bloquear o outro estabelecimento', async () => {
    for (let n = 0; n < 5; n++) {
      await challenge();
      await env.DB.prepare('UPDATE phone_challenges SET created_at=unixepoch()-61').run();
    }
    expect((await api(tomaz, '/customer/verification', { phone: alice })).status).toBe(429);
    await challenge(aurora);
    for (let n = 0; n < 15; n++) await challenge(tomaz, `7598888${String(n).padStart(4, '0')}`);
    expect((await api(tomaz, '/customer/verification', { phone: bob })).status).toBe(429);
  });
  it('mantém a reserva e não autentica quando o remetente falha ou não está configurado', async () => {
    const id = await book();
    const r = await worker.fetch(request(tomaz, '/customer/verification', { phone: alice }), {
      ...testEnv(),
      VERIFICATION_SENDER: {
        fetch: async () => new Response('', { status: 503 }),
      } as unknown as Fetcher,
    });
    expect(r.status).toBe(503);
    expect(
      (
        await worker.fetch(request(aurora, '/customer/verification', { phone: alice }), {
          ...testEnv(),
          VERIFICATION_SENDER: undefined,
        })
      ).status,
    ).toBe(503);
    expect(
      await env.DB.prepare('SELECT status FROM appointments WHERE id=?').bind(id).first('status'),
    ).toBe('confirmed');
    expect((await api(tomaz, '/customer/bookings')).status).toBe(401);
  });
  it('logout revoga a sessão e sessões expiradas não são aceitas', async () => {
    const cookie = await verify();
    expect((await api(tomaz, '/customer/logout', {}, cookie)).status).toBe(200);
    expect((await api(tomaz, '/customer/session', undefined, cookie)).status).toBe(401);
    const other = await verify(aurora);
    await env.DB.prepare('UPDATE customer_sessions SET expires_at=unixepoch()-1').run();
    expect((await api(aurora, '/customer/session', undefined, other)).status).toBe(401);
  });
  it('exige origem correta e valida o celular e os seis dígitos', async () => {
    for (const phone of ['123', {}, '75999999999999999999999999999999999999'])
      expect((await api(tomaz, '/customer/verification', { phone })).status).toBe(400);
    expect(
      (await api(tomaz, '/customer/verify', { challengeId: crypto.randomUUID(), code: '123' }))
        .status,
    ).toBe(400);
    const r = request(tomaz, '/customer/verification', { phone: alice });
    r.headers.set('Origin', 'https://outro.test');
    expect((await worker.fetch(r, testEnv())).status).toBe(403);
  });
});
describe('Meus horários por cliente e estabelecimento', () => {
  it('dois clientes e dois salões veem apenas suas reservas, inclusive as cadastradas pelo hub', async () => {
    const a = await book(tomaz, alice, '10:00', true),
      b = await book(tomaz, bob, '11:00'),
      c = await book(aurora, alice);
    const aSession = await verify(),
      bSession = await verify(tomaz, bob),
      auroraSession = await verify(aurora);
    for (const [shop, cookie, id] of [
      [tomaz, aSession, a],
      [tomaz, bSession, b],
      [aurora, auroraSession, c],
    ]) {
      const r = await api(shop, '/customer/bookings', undefined, cookie);
      expect(r.status).toBe(200);
      const d = await r.json<CustomerBookings>();
      expect(d.appointments.map((a) => a.id)).toEqual([id]);
      expect(JSON.stringify(d)).not.toMatch(
        /customer_phone|customer_name|phone_hash|reminder|action_key|professional_id/,
      );
    }
    expect((await api(aurora, '/customer/bookings', undefined, aSession)).status).toBe(401);
    expect((await api(tomaz, `/customer/bookings/${b}`, undefined, aSession)).status).toBe(404);
    expect((await api(tomaz, `/customer/bookings/${c}`, undefined, aSession)).status).toBe(404);
    expect(
      (await api(tomaz, `/customer/bookings/${b}/availability?date=${day}`, undefined, aSession))
        .status,
    ).toBe(404);
    for (const kind of ['reschedule', 'cancel'])
      expect((await change(b, kind, action(1, at('12:00')), aSession)).status).toBe(404);
    const r = await api(
      tomaz,
      '/customer/bookings?phone=75999992222&customerId=anything',
      undefined,
      aSession,
    );
    expect((await r.json<CustomerBookings>()).appointments.map((a) => a.id)).toEqual([a]);
  });
  it('retorna lista vazia para número sem reservas e valida filtros e cursores', async () => {
    const cookie = await verify();
    expect(
      (await (await api(tomaz, '/customer/bookings', undefined, cookie)).json<CustomerBookings>())
        .appointments,
    ).toEqual([]);
    expect((await api(tomaz, '/customer/bookings?cursor=bad', undefined, cookie)).status).toBe(400);
    expect(
      (await api(tomaz, `/customer/bookings?cursor=${at('10:00')}:demo-tomaz`, undefined, cookie))
        .status,
    ).toBe(200);
    expect((await api(tomaz, '/customer/bookings?view=bad', undefined, cookie)).status).toBe(400);
  });
  it('conflito ao remarcar preserva horário, ocupação e lembrete originais', async () => {
    const id = await book();
    await book(tomaz, bob, '11:00');
    const cookie = await verify();
    const before = await segments(id),
      reminder = await env.DB.prepare('SELECT * FROM appointment_reminders WHERE appointment_id=?')
        .bind(id)
        .first();
    const r = await change(id, 'reschedule', action(1, at('11:00')), cookie);
    expect(r.status).toBe(409);
    expect((await detail(id, cookie)).startsAt).toBe(at('10:00'));
    expect(await segments(id)).toEqual(before);
    expect(
      await env.DB.prepare('SELECT * FROM appointment_reminders WHERE appointment_id=?')
        .bind(id)
        .first(),
    ).toEqual(reminder);
  });
  it('duas remarcações concorrentes para um intervalo confirmam somente uma', async () => {
    const a = await book(),
      b = await book(tomaz, bob, '11:00');
    const ca = await verify(),
      cb = await verify(tomaz, bob);
    const rs = await Promise.all([
      change(a, 'reschedule', action(1, at('12:00')), ca),
      change(b, 'reschedule', action(1, at('12:00')), cb),
    ]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    const records = [await detail(a, ca), await detail(b, cb)];
    expect(records.filter((a) => a.startsAt === at('12:00'))).toHaveLength(1);
    expect(
      records.filter((a) => a.startsAt === at('10:00') || a.startsAt === at('11:00')),
    ).toHaveLength(1);
    expect((await segments(a)).length + (await segments(b)).length).toBe(6);
  });
  it('corrida entre remarcação do cliente e nova reserva mantém somente uma confirmação no destino', async () => {
    const id = await book(),
      cookie = await verify();
    const rs = await Promise.all([
      change(id, 'reschedule', action(1, at('12:00')), cookie),
      SELF.fetch(
        request(tomaz, '/bookings', {
          name: 'Bruno Cliente',
          phone: bob,
          serviceId: 'corte',
          startsAt: at('12:00'),
          requestKey: crypto.randomUUID(),
        }),
      ),
    ]);
    expect(rs.map((r) => r.status).sort()).toEqual(rs[0].status === 200 ? [200, 409] : [201, 409]);
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS n FROM appointments WHERE shop_id=? AND starts_at=? AND status='confirmed'",
      )
        .bind(tomaz, at('12:00'))
        .first('n'),
    ).toBe(1);
  });
  it('remarca com snapshot original, atualiza lembrete, libera origem e respeita faixa oculta ao cliente', async () => {
    const id = await book(),
      cookie = await verify();
    await env.DB.prepare(
      "UPDATE services SET duration=60,price='R$ 99,00' WHERE shop_id=? AND id='corte'",
    )
      .bind(tomaz)
      .run();
    await env.DB.prepare(
      "INSERT INTO availability_rules(shop_id,professional_id,from_date,to_date,starts_at,ends_at,scope) VALUES (?,'principal',?,?,660,720,'online')",
    )
      .bind(tomaz, day, day)
      .run();
    expect((await change(id, 'reschedule', action(1, at('11:00')), cookie)).status).toBe(400);
    const data = action(1, at('12:00'));
    const r = await change(id, 'reschedule', data, cookie);
    expect(r.status).toBe(200);
    const d = await detail(id, cookie);
    expect(d.duration).toBe(30);
    expect(d.price).toContain('30,00');
    expect(d.startsAt).toBe(at('12:00'));
    expect(
      await env.DB.prepare(
        'SELECT starts_at FROM occupied_segments WHERE shop_id=? AND starts_at=?',
      )
        .bind(tomaz, at('10:00'))
        .first(),
    ).toBeNull();
    expect(
      await env.DB.prepare('SELECT due_at FROM appointment_reminders WHERE appointment_id=?')
        .bind(id)
        .first('due_at'),
    ).toBe(at('12:00') - 600);
    expect((await change(id, 'reschedule', data, cookie)).status).toBe(200);
    expect(
      await env.DB.prepare('SELECT count(*) AS n FROM booking_events WHERE appointment_id=?')
        .bind(id)
        .first('n'),
    ).toBe(2);
    expect(
      await env.DB.prepare('SELECT booking_channel FROM appointments WHERE id=?')
        .bind(id)
        .first('booking_channel'),
    ).toBe('link');
  });
  it('cancela sem custo com histórico e sem alterar a reserva do outro salão', async () => {
    const id = await book(),
      other = await book(aurora),
      cookie = await verify(),
      data = action(),
      otherSegments = await segments(other);
    expect((await change(id, 'cancel', data, cookie)).status).toBe(200);
    expect((await change(id, 'cancel', data, cookie)).status).toBe(200);
    expect(await segments(id)).toEqual([]);
    expect(await segments(other)).toEqual(otherSegments);
    expect(
      await env.DB.prepare('SELECT state FROM appointment_reminders WHERE appointment_id=?')
        .bind(id)
        .first('state'),
    ).toBe('cancelled');
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS n FROM notification_outbox WHERE appointment_id=? AND kind='booking.cancelled'",
      )
        .bind(id)
        .first('n'),
    ).toBe(1);
    expect(
      (await (await api(tomaz, '/customer/bookings', undefined, cookie)).json<CustomerBookings>())
        .appointments,
    ).toHaveLength(0);
    expect(
      (
        await (
          await api(tomaz, '/customer/bookings?view=history', undefined, cookie)
        ).json<CustomerBookings>()
      ).appointments[0].status,
    ).toBe('cancelled');
    expect((await change(id, 'reschedule', action(2, at('13:00')), cookie)).status).toBe(409);
  });
  it('não aplica taxa nem libera a reserva dentro de duas horas; o hub mantém a decisão', async () => {
    const id = await book(),
      cookie = await verify();
    const soon = Math.ceil((Date.now() / 1000 + 3600) / 600) * 600;
    await env.DB.prepare(
      'UPDATE appointments SET starts_at=?,ends_at=?,version=version+1,action_key=? WHERE id=?',
    )
      .bind(soon, soon + 1800, crypto.randomUUID(), id)
      .run();
    expect((await detail(id, cookie)).canCancel).toBe(false);
    expect((await change(id, 'cancel', action(2), cookie)).status).toBe(422);
    expect((await change(id, 'reschedule', action(2, at('13:00')), cookie)).status).toBe(422);
    expect(await segments(id)).toHaveLength(3);
    expect(
      await env.DB.prepare('SELECT status FROM appointments WHERE id=?').bind(id).first('status'),
    ).toBe('confirmed');
    const login = await SELF.fetch(
      request(tomaz, '/admin/login', { password: JSON.parse(env.ADMIN_PASSWORDS!)[tomaz] }),
    );
    const admin = login.headers.get('Set-Cookie')!.split(';')[0];
    expect(
      (await SELF.fetch(request(tomaz, `/admin/bookings/${id}/cancel`, action(2), admin))).status,
    ).toBe(200);
  });
});
