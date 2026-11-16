import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, it, expect } from 'vitest';
import { addDays, localDate } from '../src/shared';
import { parseMoney, suggestedAmount, type ReceiptReport } from '../src/finance';
const origin = 'https://tomaz.test',
  tomaz = 'tomaz-barber',
  aurora = 'salao-aurora';
const today = localDate(),
  yesterday = addDays(today, -1),
  lastMonth = addDays(`${today.slice(0, 7)}-01`, -1);
let day = addDays(today, 5);
while ([0, 1].includes(new Date(`${day}T12:00:00Z`).getUTCDay())) day = addDays(day, 1);
const at = (time: string, date = day) => Date.parse(`${date}T${time}:00-03:00`) / 1000;
const post = (shop: string, path: string, data: unknown, cookie = '') =>
  SELF.fetch(`${origin}/api/shops/${shop}${path}`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(data),
  });
const get = (shop: string, path: string, cookie = '') =>
  SELF.fetch(`${origin}/api/shops/${shop}${path}`, { headers: { Cookie: cookie } });
async function login(shop = tomaz) {
  const r = await post(shop, '/admin/login', { password: JSON.parse(env.ADMIN_PASSWORDS!)[shop] });
  expect(r.status).toBe(200);
  return r.headers.get('Set-Cookie')!.split(';')[0];
}
async function book(time = '10:00', shop = tomaz, phone = '75999990701', serviceId = 'corte') {
  const r = await post(shop, '/bookings', {
    name: 'Cliente Fictício',
    phone,
    serviceId,
    startsAt: at(time),
    requestKey: crypto.randomUUID(),
  });
  expect(r.status).toBe(201);
  return (await r.json<{ appointment: { id: string; manageUrl: string } }>()).appointment;
}
const payment = (amountCents = 3000, paidOn = today, method = 'pix') => ({
  requestKey: crypto.randomUUID(),
  amountCents,
  paidOn,
  method,
});
const pay = (id: string, data = payment(), cookie = '', shop = tomaz) =>
  post(shop, `/admin/bookings/${id}/payment`, data, cookie);
const complete = (id: string, cookie: string, key = crypto.randomUUID(), expectedVersion = 2) =>
  post(tomaz, `/admin/bookings/${id}/complete`, { requestKey: key, expectedVersion }, cookie);
async function past(id: string, time = '10:00') {
  await env.DB.prepare(
    'UPDATE appointments SET starts_at=?,ends_at=?+duration_minutes*60,version=version+1 WHERE id=?',
  )
    .bind(at(time, yesterday), at(time, yesterday), id)
    .run();
}
async function report(cookie: string, query = '', shop = tomaz) {
  const r = await get(shop, `/admin/receipts${query}`, cookie);
  expect(r.status).toBe(200);
  return r.json<ReceiptReport>();
}
describe('recebimentos e conclusão por estabelecimento', () => {
  it('conclui sem registrar pagamento, mantém ocupação e suprime lembrete; reenvio não duplica', async () => {
    const a = await book(),
      c = await login();
    await past(a.id);
    const key = crypto.randomUUID();
    expect((await complete(a.id, c, key)).status).toBe(200);
    expect((await complete(a.id, c, key)).status).toBe(200);
    const detail = await (
      await get(tomaz, `/admin/bookings/${a.id}`, c)
    ).json<{
      appointment: { completed_at: number; version: number };
      reminder: { state: string; due_at: null };
    }>();
    expect(detail.appointment.completed_at).toBeGreaterThan(0);
    expect(detail.appointment.version).toBe(3);
    expect(detail.reminder).toMatchObject({ state: 'suppressed', due_at: null });
    expect((await report(c)).total_cents).toBe(0);
    expect(
      await env.DB.prepare('SELECT count(*) AS n FROM occupied_segments WHERE appointment_id=?')
        .bind(a.id)
        .first('n'),
    ).toBe(3);
    const r = await post(
      tomaz,
      `/admin/bookings/${a.id}/cancel`,
      { expectedVersion: 3, requestKey: crypto.randomUUID() },
      c,
    );
    expect(r.status).toBe(409);
    expect(
      await env.DB.prepare('SELECT count(*) AS n FROM notification_outbox WHERE appointment_id=?')
        .bind(a.id)
        .first('n'),
    ).toBe(2);
  });
  it('registra pagamento antes da conclusão sem concluir, cancelar ou criar evento de WhatsApp', async () => {
    const a = await book(),
      c = await login();
    expect((await pay(a.id, payment(3200, today, 'card'), c)).status).toBe(201);
    expect(
      await env.DB.prepare('SELECT completed_at FROM appointments WHERE id=?')
        .bind(a.id)
        .first('completed_at'),
    ).toBeNull();
    expect(
      await env.DB.prepare('SELECT version FROM appointments WHERE id=?')
        .bind(a.id)
        .first('version'),
    ).toBe(1);
    expect(
      await env.DB.prepare('SELECT count(*) AS n FROM notification_outbox WHERE appointment_id=?')
        .bind(a.id)
        .first('n'),
    ).toBe(1);
    expect((await report(c)).today_cents).toBe(3200);
  });
  it('pagamento após conclusão usa valor efetivamente pago, data e forma escolhidos', async () => {
    const a = await book(),
      c = await login();
    await past(a.id);
    await complete(a.id, c);
    const r = await pay(a.id, payment(2750, yesterday, 'cash'), c);
    expect(r.status).toBe(201);
    expect((await r.json<{ receipt: unknown }>()).receipt).toMatchObject({
      amount_cents: 2750,
      paid_on: yesterday,
      method: 'cash',
      customer_name: 'Cliente Fictício',
      service_name: 'Corte masculino',
    });
    const summary = await report(c, `?from=${yesterday}&to=${today}`);
    expect(summary.today_cents).toBe(0);
    expect(summary.total_cents).toBe(2750);
  });
  it('rejeita conclusão antecipada, cancelada ou com versão desatualizada', async () => {
    const a = await book(),
      c = await login();
    expect((await complete(a.id, c, crypto.randomUUID(), 1)).status).toBe(409);
    await past(a.id);
    expect((await complete(a.id, c, crypto.randomUUID(), 1)).status).toBe(409);
    await post(
      tomaz,
      `/admin/bookings/${a.id}/cancel`,
      { expectedVersion: 2, requestKey: crypto.randomUUID() },
      c,
    );
    expect((await complete(a.id, c, crypto.randomUUID(), 3)).status).toBe(409);
    expect((await report(c)).total_cents).toBe(0);
  });
  it('duas conclusões concorrentes registram uma conclusão sem duplicar a versão', async () => {
    const a = await book(),
      c = await login();
    await past(a.id);
    const r = await Promise.all([complete(a.id, c), complete(a.id, c)]);
    expect(r.map((x) => x.status)).toEqual([200, 200]);
    expect(
      await env.DB.prepare('SELECT version FROM appointments WHERE id=?')
        .bind(a.id)
        .first('version'),
    ).toBe(3);
  });
  it('dois toques simultâneos com a mesma chave registram um recebimento', async () => {
    const a = await book(),
      c = await login(),
      data = payment();
    const r = await Promise.all([pay(a.id, data, c), pay(a.id, data, c)]);
    expect(r.map((x) => x.status).sort()).toEqual([200, 201]);
    expect((await report(c)).count).toBe(1);
    expect((await report(c)).total_cents).toBe(3000);
  });
  it('duas abas com chaves diferentes também não duplicam o pagamento', async () => {
    const a = await book(),
      c = await login();
    const r = await Promise.all([pay(a.id, payment(), c), pay(a.id, payment(), c)]);
    expect(r.map((x) => x.status).sort()).toEqual([200, 201]);
    expect((await report(c)).count).toBe(1);
  });
  it('pagamentos concorrentes divergentes não sobrescrevem o valor vencedor', async () => {
    const a = await book(),
      c = await login();
    const r = await Promise.all([pay(a.id, payment(3000), c), pay(a.id, payment(3300), c)]);
    expect(r.map((x) => x.status).sort()).toEqual([201, 409]);
    expect([3000, 3300]).toContain((await report(c)).total_cents);
    expect((await report(c)).count).toBe(1);
  });
  it('não reutiliza a chave para outro cliente, reserva ou valor e não aceita identidades do corpo', async () => {
    const a = await book(),
      b = await book('11:00', tomaz, '75999990702'),
      c = await login(),
      data = payment();
    expect(
      (await pay(a.id, { ...data, customerId: 'outro', shopId: aurora } as typeof data, c)).status,
    ).toBe(201);
    expect((await pay(b.id, data, c)).status).toBe(409);
    expect((await pay(a.id, { ...data, amountCents: 9999 }, c)).status).toBe(409);
    const summary = await report(c);
    expect(summary.receipts[0].appointment_id).toBe(a.id);
    expect(summary.clients).toHaveLength(1);
  });
  it('rejeita valores, formas e datas inválidos ou futuros sem lançar caixa', async () => {
    const a = await book(),
      c = await login();
    for (const delta of [
      { amountCents: 0 },
      { amountCents: -1 },
      { amountCents: 1.5 },
      { amountCents: 100000000 },
      { amountCents: '3000' },
      { method: 'boleto' },
      { method: '__proto__' },
      { paidOn: '2026-02-30' },
      { paidOn: addDays(today, 1) },
      { paidOn: '1999-12-31' },
      { requestKey: 'invalido' },
    ])
      expect(
        (await pay(a.id, { ...payment(), ...delta } as ReturnType<typeof payment>, c)).status,
      ).toBe(400);
    expect((await report(c)).total_cents).toBe(0);
  });
  it('cada painel só acessa seus recebimentos mesmo copiando cookie ou tentando IDs do outro salão', async () => {
    const a = await book(),
      b = await book('10:00', aurora),
      ca = await login(),
      cb = await login(aurora);
    expect((await pay(a.id, payment(3000), ca)).status).toBe(201);
    expect((await pay(b.id, payment(5500), cb, aurora)).status).toBe(201);
    expect((await report(ca)).total_cents).toBe(3000);
    expect((await report(cb, '', aurora)).total_cents).toBe(5500);
    expect((await get(aurora, '/admin/receipts', ca)).status).toBe(401);
    expect((await get(tomaz, `/admin/bookings/${b.id}/payment`, ca)).status).toBe(404);
    expect((await pay(b.id, payment(), ca)).status).toBe(404);
    expect(
      (
        await post(
          tomaz,
          `/admin/bookings/${b.id}/complete`,
          { requestKey: crypto.randomUUID(), expectedVersion: 1 },
          ca,
        )
      ).status,
    ).toBe(404);
    expect(JSON.stringify(await report(ca))).not.toContain(b.id);
  });
  it('rotas financeiras exigem sessão administrativa e origem correta', async () => {
    const a = await book(),
      c = await login();
    expect((await get(tomaz, '/admin/receipts')).status).toBe(401);
    expect((await pay(a.id)).status).toBe(401);
    expect((await complete(a.id, '')).status).toBe(401);
    const r = await SELF.fetch(`${origin}/api/shops/${tomaz}/admin/bookings/${a.id}/payment`, {
      method: 'POST',
      headers: { Origin: 'https://outra.test', 'Content-Type': 'application/json', Cookie: c },
      body: JSON.stringify(payment()),
    });
    expect(r.status).toBe(403);
    const token = new URL(a.manageUrl, origin).hash.slice(8);
    const session = await post(tomaz, `/booking-access/${a.id}/session`, { token });
    expect(session.status).toBe(200);
    expect(
      (await get(tomaz, '/admin/receipts', session.headers.get('Set-Cookie')!.split(';')[0]))
        .status,
    ).toBe(401);
  });
  it('caixa usa data do pagamento: reservas, cancelamentos e faltas sem recebimento não entram', async () => {
    const a = await book(),
      b = await book('11:00'),
      c = await book('12:00'),
      d = await book('13:00'),
      cookie = await login();
    await past(d.id, '13:00'); // atendimento passado sem pagamento: nenhuma taxa presumida
    await post(
      tomaz,
      `/admin/bookings/${b.id}/cancel`,
      { expectedVersion: 1, requestKey: crypto.randomUUID() },
      cookie,
    );
    expect((await report(cookie)).total_cents).toBe(0);
    await pay(a.id, payment(3000, today), cookie);
    await pay(b.id, payment(1500, today, 'cash'), cookie);
    await pay(c.id, payment(2500, lastMonth, 'card'), cookie);
    const month = await report(cookie);
    expect(month.total_cents).toBe(4500);
    expect(month.today_cents).toBe(4500);
    expect(month.month_cents).toBe(4500);
    const older = await report(cookie, `?from=${lastMonth}&to=${lastMonth}`);
    expect(older.total_cents).toBe(2500);
    expect(older.today_cents).toBe(4500);
    expect(older.month_cents).toBe(4500);
  });
  it('agrupa por cliente, serviço e forma com totais consistentes e IDs próprios', async () => {
    const a = await book(),
      b = await book('11:00', tomaz, '75999990701', 'barba'),
      c = await book('12:00', tomaz, '75999990702'),
      cookie = await login();
    await pay(a.id, payment(3300, today, 'card'), cookie);
    await pay(b.id, payment(1500, today, 'cash'), cookie);
    await pay(c.id, payment(3000, today, 'pix'), cookie);
    const r = await report(cookie);
    expect(r.total_cents).toBe(7800);
    expect(r.count).toBe(3);
    expect(r.clients).toHaveLength(2);
    expect(r.clients[0].total_cents).toBe(4800);
    expect(r.services).toHaveLength(2);
    expect(r.methods).toHaveLength(3);
    for (const group of [r.clients, r.services, r.methods])
      expect(group.reduce((sum, g) => sum + g.total_cents, 0)).toBe(7800);
  });
  it('rejeita períodos invertidos, datas inexistentes e intervalos maiores que 366 dias', async () => {
    const c = await login();
    for (const query of [
      `?from=${today}&to=${yesterday}`,
      '?from=2026-02-30',
      `?from=${addDays(today, -366)}&to=${today}`,
      `?to=${addDays(today, 1)}`,
      '?cursor=invalido',
    ])
      expect((await get(tomaz, `/admin/receipts${query}`, c)).status).toBe(400);
  });
  it('página de recebimentos não repete registros nem limita os totais e agrupamentos', async () => {
    const a = await book(),
      cookie = await login();
    const customer = await env.DB.prepare('SELECT customer_id FROM appointments WHERE id=?')
      .bind(a.id)
      .first<string>('customer_id');
    const rows = Array.from({ length: 51 }, (_, i) => ({
      id: crypto.randomUUID(),
      key: crypto.randomUUID(),
      cents: i + 1,
    }));
    // Registros históricos em datas diferentes permitem testar paginação sem depender do expediente atual.
    await env.DB.batch(
      rows.map((r, i) =>
        env.DB.prepare(
          `INSERT INTO appointments(id,shop_id,professional_id,customer_id,request_key,request_fingerprint,origin,customer_name,customer_phone,service_id,service_name,price_label,duration_minutes,starts_at,ends_at,booking_channel) VALUES (?,'tomaz-barber','principal',?,?,'fixture','hub','Cliente Fictício','+5575999990701','corte','Corte masculino','R$ 30,00',30,?,?, 'hub')`,
        ).bind(
          r.id,
          customer,
          r.key,
          at('10:00', addDays(yesterday, -i - 1)),
          at('10:30', addDays(yesterday, -i - 1)),
        ),
      ),
    );
    await env.DB.batch(
      rows.map((r) =>
        env.DB.prepare(
          `INSERT INTO receipts(id,shop_id,appointment_id,customer_id,customer_name,service_id,service_name,amount_cents,paid_on,method,request_key,fingerprint) VALUES (?,'tomaz-barber',?,?,'Cliente Fictício','corte','Corte masculino',?,?,'pix',?,'fixture')`,
        ).bind(crypto.randomUUID(), r.id, customer, r.cents, today, r.key),
      ),
    );
    const first = await report(cookie);
    expect(first.count).toBe(51);
    expect(first.receipts).toHaveLength(50);
    expect(first.total_cents).toBe(1326);
    expect(first.clients[0].total_cents).toBe(1326);
    const second = await report(cookie, `?cursor=${encodeURIComponent(first.nextCursor!)}`);
    expect(second.receipts).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(second.total_cents).toBe(1326);
    expect(new Set([...first.receipts, ...second.receipts].map((r) => r.id)).size).toBe(51);
  });
  it('conclusão concorrente com remarcação não altera um atendimento já concluído', async () => {
    const a = await book(),
      cookie = await login();
    await past(a.id);
    const result = await Promise.all([
      complete(a.id, cookie),
      post(
        tomaz,
        `/admin/bookings/${a.id}/reschedule`,
        { expectedVersion: 2, requestKey: crypto.randomUUID(), startsAt: at('12:00') },
        cookie,
      ),
    ]);
    expect(result.map((r) => r.status).sort()).toEqual([200, 409]);
    const row = await env.DB.prepare('SELECT starts_at,completed_at FROM appointments WHERE id=?')
      .bind(a.id)
      .first<{ starts_at: number; completed_at: number | null }>();
    expect(
      row!.completed_at
        ? row!.starts_at === at('10:00', yesterday)
        : row!.starts_at === at('12:00'),
    ).toBe(true);
  });
  it('converte sugestões por forma e valores em centavos sem arredondar entradas inválidas', () => {
    expect(suggestedAmount('R$ 30,00 no Pix ou dinheiro · R$ 33,00 no cartão', 'pix')).toBe(3000);
    expect(suggestedAmount('R$ 30,00 no Pix ou dinheiro · R$ 33,00 no cartão', 'card')).toBe(3300);
    expect(suggestedAmount('A partir de R$ 60,00', 'cash')).toBe(6000);
    expect(suggestedAmount('A combinar', 'pix')).toBeNull();
    expect(parseMoney('27,50')).toBe(2750);
    expect(parseMoney('0.01')).toBe(1);
    expect(parseMoney('27,501')).toBeNull();
    expect(parseMoney('1e3')).toBeNull();
  });
});
