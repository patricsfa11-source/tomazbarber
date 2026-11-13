import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { addDays, localDate, services } from '../src/shared';
import { candidates } from '../src/server/schedule';

const base = 'https://tomaz.test';
let day = addDays(localDate(), 1);
while (new Date(`${day}T12:00:00-03:00`).getUTCDay() === 0) day = addDays(day, 1);
const at = (time: string, date = day) => Date.parse(`${date}T${time}:00-03:00`) / 1000;
const payload = (time = '10:00', serviceId = 'corte') => ({
  serviceId,
  startsAt: at(time),
  name: 'João Fictício',
  phone: '(75) 99999-0000',
  requestKey: crypto.randomUUID(),
});
function post(path: string, data: unknown, cookie = '') {
  return SELF.fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base, Cookie: cookie },
    body: JSON.stringify(data),
  });
}
async function session() {
  const response = await post('/api/admin/login', { password: env.ADMIN_PASSWORD });
  expect(response.status).toBe(200);
  return response.headers.get('Set-Cookie')!.split(';')[0];
}
async function slots(serviceId = 'corte') {
  const response = await SELF.fetch(`${base}/api/availability?date=${day}&serviceId=${serviceId}`);
  expect(response.status).toBe(200);
  return (await response.json<{ slots: number[] }>()).slots;
}
async function counts() {
  return {
    appointments: (await env.DB.prepare('SELECT count(*) n FROM appointments').first<{
      n: number;
    }>())!.n,
    segments: (await env.DB.prepare('SELECT count(*) n FROM occupied_segments').first<{
      n: number;
    }>())!.n,
  };
}
describe('catálogo e expediente da Bahia', () => {
  it('oferece os sete serviços, os dois preços do corte e preço inicial de luzes', async () => {
    const response = await SELF.fetch(`${base}/api/services`);
    expect(response.status).toBe(200);
    expect((await response.json<{ services: typeof services }>()).services).toEqual(services);
    expect(services.map((s) => [s.id, s.duration, s.price])).toEqual([
      ['corte', 30, 'R$ 30,00 no Pix ou dinheiro · R$ 33,00 no cartão'],
      ['barba', 20, 'R$ 15,00'],
      ['corte-barba', 40, 'R$ 38,00'],
      ['pe', 20, 'R$ 15,00'],
      ['pe-barba', 60, 'R$ 20,00'],
      ['pigmentacao', 60, 'R$ 20,00'],
      ['luzes', 60, 'A partir de R$ 60,00'],
    ]);
  });
  it('cabe corte às 19h30 e combo apenas até 19h20', async () => {
    expect((await slots()).at(-1)).toBe(at('19:30'));
    expect((await slots('corte-barba')).at(-1)).toBe(at('19:20'));
    expect((await slots())[0]).toBe(at('07:30'));
  });
  it('fecha domingo e rejeita confirmação no domingo', async () => {
    let sunday = day;
    while (new Date(`${sunday}T12:00:00-03:00`).getUTCDay() !== 0) sunday = addDays(sunday, 1);
    const response = await SELF.fetch(`${base}/api/availability?date=${sunday}&serviceId=corte`);
    expect((await response.json<{ slots: number[] }>()).slots).toEqual([]);
    expect(
      (await post('/api/bookings', { ...payload(), startsAt: at('10:00', sunday) })).status,
    ).toBe(400);
  });
  it('oculta horários passados e usa a data da Bahia na virada UTC', () => {
    expect(localDate(new Date('2026-11-14T01:00:00Z'))).toBe('2026-11-13');
    expect(candidates(day, 30, at('09:00') * 1000)[0]).toBe(at('09:10'));
  });
  it.each(['2026-02-30', 'ontem', '2099-01-01', '2020-01-01'])(
    'rejeita data inválida %s',
    async (date) => {
      expect(
        (await SELF.fetch(`${base}/api/availability?date=${date}&serviceId=corte`)).status,
      ).toBe(400);
    },
  );
});
describe('agenda única e concorrência no D1', () => {
  it('duas solicitações simultâneas no mesmo início confirmam uma só', async () => {
    const responses = await Promise.all([
      post('/api/bookings', payload()),
      post('/api/bookings', payload()),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await counts()).toEqual({ appointments: 1, segments: 3 });
  });
  it('inícios diferentes sobrepostos confirmam uma só, sem segmentos órfãos', async () => {
    const responses = await Promise.all([
      post('/api/bookings', payload('10:00', 'corte-barba')),
      post('/api/bookings', payload('10:30', 'corte-barba')),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await counts()).toEqual({ appointments: 1, segments: 4 });
    // A parte não sobreposta da tentativa perdedora continua livre.
    const winner = await env.DB.prepare('SELECT starts_at FROM appointments').first<{
      starts_at: number;
    }>();
    expect(await slots('barba')).toContain(
      winner!.starts_at === at('10:00') ? at('10:40') : at('10:00'),
    );
  });
  it('link e hub competem pela mesma restrição', async () => {
    const cookie = await session();
    const responses = await Promise.all([
      post('/api/bookings', payload('11:00', 'corte-barba')),
      post('/api/admin/bookings', payload('11:30', 'barba'), cookie),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await counts()).appointments).toBe(1);
  });
  it('encaixe de 40 minutos ocupa todo o intervalo e permite reserva adjacente', async () => {
    const cookie = await session();
    expect(
      (await post('/api/admin/bookings', payload('10:00', 'corte-barba'), cookie)).status,
    ).toBe(201);
    const available = await slots('barba');
    for (const time of ['09:50', '10:00', '10:10', '10:20', '10:30'])
      expect(available).not.toContain(at(time));
    expect(available).toContain(at('09:40'));
    expect(available).toContain(at('10:40'));
    expect((await post('/api/bookings', payload('10:40', 'barba'))).status).toBe(201);
    const response = await SELF.fetch(`${base}/api/admin/bookings?date=${day}`, {
      headers: { Cookie: cookie },
    });
    const result = await response.json<{ appointments: { origin: string }[] }>();
    expect(result.appointments.map((a) => a.origin)).toEqual(['hub', 'link']);
  });
  it('repetição simultânea da mesma solicitação devolve a mesma reserva', async () => {
    const input = payload();
    const responses = await Promise.all([
      post('/api/bookings', input),
      post('/api/bookings', input),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
    const results = await Promise.all(
      responses.map((r) => r.json<{ appointment: { id: string } }>()),
    );
    expect(results[0].appointment.id).toBe(results[1].appointment.id);
    expect(await counts()).toEqual({ appointments: 1, segments: 3 });
    expect((await post('/api/bookings', input)).status).toBe(200);
    expect((await post('/api/bookings', { ...input, name: 'Outro Fictício' })).status).toBe(409);
  });
  it('protege até inserções SQL diretas e desfaz toda a tentativa conflitante', async () => {
    await post('/api/bookings', payload('10:00', 'corte-barba'));
    const a = await env.DB.prepare('SELECT * FROM appointments').first<
      Record<string, string | number>
    >();
    await expect(
      env.DB.prepare(
        `INSERT INTO appointments (id,shop_id,customer_id,request_key,request_fingerprint,origin,customer_name,customer_phone,service_id,service_name,price_label,duration_minutes,starts_at,ends_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
        .bind(
          'direta',
          a!.shop_id,
          a!.customer_id,
          'direta',
          'fingerprint',
          'hub',
          a!.customer_name,
          a!.customer_phone,
          'barba',
          'Barba',
          'R$ 15,00',
          20,
          at('09:50'),
          at('10:10'),
        )
        .run(),
    ).rejects.toThrow('UNIQUE constraint failed');
    expect(await counts()).toEqual({ appointments: 1, segments: 4 });
  });
  it('preserva serviço e preço no instante da reserva e normaliza telefone', async () => {
    expect((await post('/api/bookings', payload())).status).toBe(201);
    const a = await env.DB.prepare('SELECT * FROM appointments').first();
    expect(a).toMatchObject({
      customer_phone: '+5575999990000',
      service_name: 'Corte masculino',
      price_label: services[0].price,
      duration_minutes: 30,
    });
  });
  it.each(['07:20', '10:05', '19:40', '20:00'])(
    'rejeita início fora da grade ou duração fora do expediente: %s',
    async (time) => {
      expect((await post('/api/bookings', payload(time))).status).toBe(400);
      expect((await counts()).appointments).toBe(0);
    },
  );
});
describe('acesso e validação', () => {
  it('bloqueia dados e operações administrativas sem sessão', async () => {
    expect((await SELF.fetch(`${base}/api/admin/bookings?date=${day}`)).status).toBe(401);
    expect((await post('/api/admin/bookings', payload())).status).toBe(401);
    expect(
      (await SELF.fetch(`${base}/api/admin/availability?date=${day}&serviceId=corte`)).status,
    ).toBe(401);
  });
  it('não expõe cliente nas respostas públicas e não oferece busca por telefone', async () => {
    const response = await post('/api/bookings', payload());
    const text = await response.text();
    expect(text).not.toContain('João');
    expect(text).not.toContain('99999');
    const publicResponse = await SELF.fetch(`${base}/api/availability?date=${day}&serviceId=corte`);
    const publicText = await publicResponse.text();
    expect(publicText).not.toContain('customer');
    expect(publicText).not.toContain('João');
    expect((await SELF.fetch(`${base}/api/bookings?phone=75999990000`)).status).toBe(404);
  });
  it('exige origem da aplicação e não aceita origem cruzada', async () => {
    const response = await SELF.fetch(`${base}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://outro.test' },
      body: JSON.stringify(payload()),
    });
    expect(response.status).toBe(403);
  });
  it.each([
    { name: 'João' },
    { phone: '123' },
    { serviceId: 'inexistente' },
    { startsAt: 9007199254740990 },
    { startsAt: '10h' },
    { requestKey: 'abc' },
  ])('valida dados no servidor: %j', async (invalid) => {
    expect((await post('/api/bookings', { ...payload(), ...invalid })).status).toBe(400);
  });
  it('encerra a sessão no logout e não aceita cookie inventado ou expirado', async () => {
    const cookie = await session();
    expect(
      (await SELF.fetch(`${base}/api/admin/session`, { headers: { Cookie: cookie } })).status,
    ).toBe(200);
    expect((await post('/api/admin/logout', {}, cookie)).status).toBe(200);
    expect(
      (await SELF.fetch(`${base}/api/admin/session`, { headers: { Cookie: cookie } })).status,
    ).toBe(401);
    expect(
      (
        await SELF.fetch(`${base}/api/admin/session`, {
          headers: { Cookie: `tb_session=${'a'.repeat(64)}` },
        })
      ).status,
    ).toBe(401);
    const expiredCookie = await session();
    await env.DB.prepare('UPDATE admin_sessions SET expires_at = unixepoch() - 1').run();
    expect(
      (await SELF.fetch(`${base}/api/admin/session`, { headers: { Cookie: expiredCookie } }))
        .status,
    ).toBe(401);
  });
  it('limita tentativas de login e rejeita senha incorreta', async () => {
    for (let i = 0; i < 10; i++)
      expect((await post('/api/admin/login', { password: 'errada' })).status).toBe(401);
    expect((await post('/api/admin/login', { password: env.ADMIN_PASSWORD })).status).toBe(429);
  });
  it('limita tamanho do corpo e rejeita JSON malformado', async () => {
    expect((await post('/api/bookings', { ...payload(), name: 'a'.repeat(5000) })).status).toBe(
      413,
    );
    expect(
      (
        await SELF.fetch(`${base}/api/bookings`, {
          method: 'POST',
          headers: { Origin: base, 'Content-Type': 'application/json' },
          body: '{',
        })
      ).status,
    ).toBe(400);
  });
});
