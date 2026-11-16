import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, it, expect } from 'vitest';
import { addDays, localDate } from '../src/shared';
import type { CustomerBooking } from '../src/customer';
const origin = 'https://tomaz.test',
  tomaz = 'tomaz-barber',
  aurora = 'salao-aurora';
let day = addDays(localDate(), 3);
while ([0, 1].includes(new Date(`${day}T12:00:00Z`).getUTCDay())) day = addDays(day, 1);
const at = (time: string) => Date.parse(`${day}T${time}:00-03:00`) / 1000;
const input = (time = '10:00', name = 'Cliente Fictício', phone = '75999990600') => ({
  name,
  phone,
  serviceId: 'corte',
  startsAt: at(time),
  requestKey: crypto.randomUUID(),
});
const get = (shop: string, path: string, cookie = '') =>
  SELF.fetch(`${origin}/api/shops/${shop}${path}`, { headers: { Cookie: cookie } });
const post = (shop: string, path: string, data: unknown, cookie = '') =>
  SELF.fetch(`${origin}/api/shops/${shop}${path}`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(data),
  });
interface Receipt {
  id: string;
  manageUrl: string;
}
async function book(shop = tomaz, data = input()) {
  const r = await post(shop, '/bookings', data);
  expect(r.status).toBe(201);
  return (await r.json<{ appointment: Receipt }>()).appointment;
}
async function login(shop = tomaz) {
  const r = await post(shop, '/admin/login', { password: JSON.parse(env.ADMIN_PASSWORDS!)[shop] });
  expect(r.status).toBe(200);
  return r.headers.get('Set-Cookie')!.split(';')[0];
}
const token = (r: Receipt) =>
  new URLSearchParams(new URL(r.manageUrl, origin).hash.slice(1)).get('acesso')!;
async function access(r: Receipt, shop = tomaz) {
  const result = await post(shop, `/booking-access/${r.id}/session`, { token: token(r) });
  expect(result.status).toBe(200);
  return result.headers.get('Set-Cookie')!.split(';')[0];
}
async function detail(r: Receipt, cookie: string, shop = tomaz) {
  const d = await get(shop, `/booking-access/${r.id}`, cookie);
  expect(d.status).toBe(200);
  return (await d.json<{ appointment: CustomerBooking }>()).appointment;
}
const action = (version = 1, startsAt?: number) => ({
  expectedVersion: version,
  requestKey: crypto.randomUUID(),
  ...(startsAt !== undefined ? { startsAt } : {}),
});
describe('links privados por reserva sem envio Meta', () => {
  it('retorna link com segredo forte no fragmento e o mesmo link em reenvio idempotente', async () => {
    const data = input(),
      a = await book(tomaz, data),
      r = await post(tomaz, '/bookings', data);
    expect(r.status).toBe(200);
    const b = (await r.json<{ appointment: Receipt }>()).appointment;
    expect(a.manageUrl).toBe(b.manageUrl);
    expect(token(a)).toMatch(/^[a-f0-9]{64}$/);
    expect(new URL(a.manageUrl, origin).pathname).toBe(`/s/${tomaz}/reserva/${a.id}`);
    const stored = await env.DB.prepare(
      'SELECT token_hash FROM booking_links WHERE appointment_id=?',
    )
      .bind(a.id)
      .first<{ token_hash: string }>();
    expect(stored!.token_hash).not.toBe(token(a));
    expect(await env.DB.prepare('SELECT count(*) AS n FROM booking_links').first('n')).toBe(1);
  });
  it('abre somente a reserva autorizada com cookie privado de 24h e não expõe nome/telefone', async () => {
    const a = await book(),
      b = await book(tomaz, input('11:00'));
    const r = await post(tomaz, `/booking-access/${a.id}/session`, { token: token(a) });
    const c = r.headers.get('Set-Cookie')!;
    for (const attr of [
      'HttpOnly',
      'SameSite=Strict',
      'Secure',
      'Max-Age=86400',
      `Path=/api/shops/${tomaz}/booking-access/${a.id}`,
    ])
      expect(c).toContain(attr);
    const cookie = c.split(';')[0];
    expect((await detail(a, cookie)).id).toBe(a.id);
    expect((await get(tomaz, `/booking-access/${b.id}`, cookie)).status).toBe(401);
    const json = await (await get(tomaz, `/booking-access/${a.id}`, cookie)).text();
    expect(json).not.toContain('customer_phone');
    expect(json).not.toContain('customer_name');
    expect((await get(tomaz, '/customer/bookings', cookie)).status).not.toBe(200);
    expect((await get(tomaz, '/admin/bookings?date=' + day, cookie)).status).toBe(401);
  });
  it('nome, telefone, id da reserva e um segredo de outra pessoa não liberam acesso', async () => {
    const a = await book(),
      b = await book(tomaz, input('11:00', 'Outro Cliente', '75999990601'));
    for (const data of [
      { name: 'Cliente Fictício' },
      { phone: '75999990600' },
      { id: a.id },
      { token: token(b) },
      { token: '0'.repeat(64) },
    ])
      expect((await post(tomaz, `/booking-access/${a.id}/session`, data)).status).toBe(401);
    expect(
      (await get(tomaz, `/booking-access/${a.id}?name=Cliente&phone=75999990600`)).status,
    ).toBe(401);
    expect(
      (
        await post(tomaz, '/bookings', {
          ...input(),
          name: 'Outro Cliente',
          phone: '75999990601',
          requestKey: crypto.randomUUID(),
        })
      ).status,
    ).toBe(409);
  });
  it('dois salões podem reservar o mesmo horário e não compartilham link, clientes ou sessão', async () => {
    const a = await book(),
      b = await book(aurora);
    expect(a.id).not.toBe(b.id);
    expect(token(a)).not.toBe(token(b));
    const ca = await access(a),
      cb = await access(b, aurora);
    expect((await get(aurora, `/booking-access/${b.id}`, ca)).status).toBe(401);
    expect(
      (await post(aurora, `/booking-access/${b.id}/session`, { token: token(a) })).status,
    ).toBe(401);
    expect((await detail(a, ca)).startsAt).toBe(at('10:00'));
    expect((await detail(b, cb, aurora)).startsAt).toBe(at('10:00'));
    expect((await post(tomaz, `/booking-access/${a.id}/cancel`, action(), cb)).status).toBe(401);
  });
  it('remarca com conflito preserva a origem e depois confirma antes de liberar o horário antigo', async () => {
    const a = await book();
    await book(tomaz, input('11:00', 'Outro Cliente', '75999990601'));
    const c = await access(a);
    expect(
      (await post(tomaz, `/booking-access/${a.id}/reschedule`, action(1, at('11:00')), c)).status,
    ).toBe(409);
    expect((await detail(a, c)).startsAt).toBe(at('10:00'));
    const data = action(1, at('12:00'));
    expect((await post(tomaz, `/booking-access/${a.id}/reschedule`, data, c)).status).toBe(200);
    expect((await post(tomaz, `/booking-access/${a.id}/reschedule`, data, c)).status).toBe(200);
    expect((await detail(a, c)).startsAt).toBe(at('12:00'));
    expect(
      await env.DB.prepare('SELECT count(*) AS n FROM occupied_segments WHERE appointment_id=?')
        .bind(a.id)
        .first('n'),
    ).toBe(3);
    expect(
      await env.DB.prepare(
        'SELECT starts_at FROM occupied_segments WHERE shop_id=? AND starts_at=?',
      )
        .bind(tomaz, at('10:00'))
        .first(),
    ).toBeNull();
  });
  it('duas remarcações concorrentes para o mesmo destino confirmam apenas uma', async () => {
    const a = await book(),
      b = await book(tomaz, input('11:00', 'Outro Cliente', '75999990601')),
      ca = await access(a),
      cb = await access(b);
    const results = await Promise.all([
      post(tomaz, `/booking-access/${a.id}/reschedule`, action(1, at('12:00')), ca),
      post(tomaz, `/booking-access/${b.id}/reschedule`, action(1, at('12:00')), cb),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      [await detail(a, ca), await detail(b, cb)].filter((a) => a.startsAt === at('12:00')),
    ).toHaveLength(1);
  });
  it('cancela, libera o intervalo e mantém registro e acesso de leitura ao cancelamento', async () => {
    const a = await book(),
      c = await access(a),
      data = action();
    expect((await post(tomaz, `/booking-access/${a.id}/cancel`, data, c)).status).toBe(200);
    expect((await post(tomaz, `/booking-access/${a.id}/cancel`, data, c)).status).toBe(200);
    expect((await detail(a, c)).status).toBe('cancelled');
    expect(
      await env.DB.prepare('SELECT count(*) AS n FROM occupied_segments WHERE appointment_id=?')
        .bind(a.id)
        .first('n'),
    ).toBe(0);
    expect(
      await env.DB.prepare('SELECT count(*) AS n FROM booking_events WHERE appointment_id=?')
        .bind(a.id)
        .first('n'),
    ).toBe(2);
    expect((await detail(a, await access(a))).status).toBe('cancelled');
  });
  it('rejeita sessão expirada e revoga link sem restaurá-lo por reenvio da criação', async () => {
    const data = input(),
      a = await book(tomaz, data),
      c = await access(a);
    await env.DB.prepare('UPDATE booking_link_sessions SET expires_at=unixepoch()-1').run();
    expect((await get(tomaz, `/booking-access/${a.id}`, c)).status).toBe(401);
    const fresh = await access(a);
    expect(
      (await post(tomaz, `/admin/bookings/${a.id}/access/revoke`, {}, await login())).status,
    ).toBe(200);
    expect((await get(tomaz, `/booking-access/${a.id}`, fresh)).status).toBe(401);
    expect((await post(tomaz, `/booking-access/${a.id}/session`, { token: token(a) })).status).toBe(
      401,
    );
    const retry = await post(tomaz, '/bookings', data);
    expect(
      (await retry.json<{ appointment: { manageUrl: null } }>()).appointment.manageUrl,
    ).toBeNull();
  });
  it('fechar acesso revoga somente a sessão atual e permite voltar com o link original', async () => {
    const a = await book(),
      c = await access(a);
    expect((await post(tomaz, `/booking-access/${a.id}/logout`, {}, c)).status).toBe(200);
    expect((await get(tomaz, `/booking-access/${a.id}`, c)).status).toBe(401);
    expect((await detail(a, await access(a))).status).toBe('confirmed');
  });
  it('escritas exigem origem e não autorizam operação em outra reserva pelo corpo', async () => {
    const a = await book(),
      b = await book(tomaz, input('11:00')),
      c = await access(a);
    const r = await SELF.fetch(`${origin}/api/shops/${tomaz}/booking-access/${a.id}/cancel`, {
      method: 'POST',
      headers: { Origin: 'https://outro.test', 'Content-Type': 'application/json', Cookie: c },
      body: JSON.stringify(action()),
    });
    expect(r.status).toBe(403);
    expect(
      (
        await post(
          tomaz,
          `/booking-access/${b.id}/cancel`,
          { ...action(), token: token(a), phone: '75999990600' },
          c,
        )
      ).status,
    ).toBe(401);
    expect((await detail(a, c)).status).toBe('confirmed');
  });
});
describe('cadastro do hub e metadados de instalação', () => {
  it('cadastra cliente sem reserva, deduplica reenvio e mantém separação por salão', async () => {
    const ca = await login(),
      cb = await login(aurora),
      data = { name: 'Cliente do Cadastro', phone: '75999990700' };
    expect((await post(tomaz, '/admin/customers', data)).status).toBe(401);
    const a = await post(tomaz, '/admin/customers', data, ca),
      b = await post(aurora, '/admin/customers', { ...data, name: 'Cliente da Aurora' }, cb);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect((await post(tomaz, '/admin/customers', data, ca)).status).toBe(201);
    expect(
      (await post(tomaz, '/admin/customers', { ...data, name: 'Nome Diferente' }, ca)).status,
    ).toBe(409);
    const ra = await a.json<{ customer: { id: string } }>(),
      rb = await b.json<{ customer: { id: string } }>();
    expect(ra.customer.id).not.toBe(rb.customer.id);
    expect((await get(tomaz, `/admin/customers/${rb.customer.id}`, ca)).status).toBe(404);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM appointments').first('n')).toBe(0);
  });
  it('valida nome e celular no cadastro e exige sessão do estabelecimento certo', async () => {
    const c = await login();
    for (const data of [
      { name: 'Só', phone: '75999990700' },
      { name: 'Nome Completo', phone: '123' },
    ])
      expect((await post(tomaz, '/admin/customers', data, c)).status).toBe(400);
    expect(
      (await post(aurora, '/admin/customers', { name: 'Nome Completo', phone: '75999990700' }, c))
        .status,
    ).toBe(401);
  });
  it('manifestos têm identidades, escopos e ícones próprios e não contêm dados privados', async () => {
    for (const s of [tomaz, aurora]) {
      const r = await SELF.fetch(`${origin}/s/${s}/hub.webmanifest`);
      expect(r.status).toBe(200);
      expect(r.headers.get('Content-Type')).toContain('application/manifest+json');
      const m = await r.json<{
        id: string;
        scope: string;
        start_url: string;
        display: string;
        icons: { src: string; sizes: string }[];
      }>();
      expect(m.id).toBe(`/s/${s}/hub`);
      expect(m.scope).toBe(`/s/${s}/`);
      expect(m.start_url).toBe(m.id);
      expect(m.display).toBe('standalone');
      expect(m.icons.map((i) => i.sizes)).toEqual(['192x192', '512x512']);
      expect(m.icons.every((i) => i.src.includes(s))).toBe(true);
    }
    expect((await SELF.fetch(`${origin}/s/desconhecido/hub.webmanifest`)).status).toBe(404);
  });
});
