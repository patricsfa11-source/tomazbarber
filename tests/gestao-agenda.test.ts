import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { addDays, localDate } from '../src/shared';
import type {
  ScheduleView,
  ScheduleCommand,
  AppointmentDetail,
  AppointmentRecord,
} from '../src/calendar';
const base = 'https://tomaz.test',
  tomaz = 'tomaz-barber',
  aurora = 'salao-aurora';
let day = addDays(localDate(), 1);
while ([0, 1].includes(new Date(`${day}T12:00:00Z`).getUTCDay())) day = addDays(day, 1);
const at = (time: string, date = day) => Date.parse(`${date}T${time}:00-03:00`) / 1000;
const url = (s: string, p: string) => `${base}/api/shops/${s}${p}`;
const get = (s: string, p: string, cookie = '') =>
  SELF.fetch(url(s, p), { headers: { Cookie: cookie } });
const post = (s: string, p: string, data: unknown, cookie = '') =>
  SELF.fetch(url(s, p), {
    method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(data),
  });
async function login(shop = tomaz) {
  const r = await post(shop, '/admin/login', { password: JSON.parse(env.ADMIN_PASSWORDS!)[shop] });
  expect(r.status).toBe(200);
  return r.headers.get('Set-Cookie')!.split(';')[0];
}
async function config(shop: string, cookie: string) {
  const r = await get(shop, '/admin/schedule', cookie);
  expect(r.status).toBe(200);
  return r.json<ScheduleView>();
}
async function preview(shop: string, cookie: string, command: ScheduleCommand) {
  const current = await config(shop, cookie);
  const data = { command, expectedRevision: current.revision };
  const r = await post(shop, '/admin/schedule/preview', data, cookie);
  expect(r.status).toBe(200);
  return {
    ...data,
    ...(await r.json<{ previewToken: string; affected: ScheduleView['affected'] }>()),
  };
}
async function save(shop: string, cookie: string, command: ScheduleCommand) {
  const p = await preview(shop, cookie, command);
  const r = await post(shop, '/admin/schedule/save', p, cookie);
  expect(r.status).toBe(200);
  return r.json<ScheduleView>();
}
async function slots(shop = tomaz, date = day, cookie = '', appointmentId = '') {
  const path = cookie ? '/admin/availability' : '/availability';
  const r = await get(
    shop,
    `${path}?date=${date}&serviceId=corte${appointmentId ? `&appointmentId=${appointmentId}` : ''}`,
    cookie,
  );
  expect(r.status).toBe(200);
  return (await r.json<{ slots: number[] }>()).slots;
}
const booking = (time = '10:00', date = day, name = 'Cliente Teste') => ({
  name,
  phone: '75999990000',
  serviceId: 'corte',
  startsAt: at(time, date),
  requestKey: crypto.randomUUID(),
});
async function book(shop = tomaz, time = '10:00', date = day, cookie = '', name = 'Cliente Teste') {
  const r = await post(
    shop,
    cookie ? '/admin/bookings' : '/bookings',
    booking(time, date, name),
    cookie,
  );
  expect(r.status).toBe(201);
  const id = (await r.json<{ appointment: { id: string } }>()).appointment.id;
  return id;
}
async function detail(id: string, cookie: string, shop = tomaz) {
  const r = await get(shop, `/admin/bookings/${id}`, cookie);
  expect(r.status).toBe(200);
  return r.json<AppointmentDetail>();
}
const action = (version = 1, startsAt?: number) => ({
  expectedVersion: version,
  requestKey: crypto.randomUUID(),
  ...(startsAt !== undefined ? { startsAt } : {}),
});
const rule = (scope: 'online' | 'all', start = 660, end = 720): ScheduleCommand => ({
  kind: 'rule',
  from: day,
  to: day,
  startsAt: start,
  endsAt: end,
  scope,
});

describe('remarcação e cancelamento atômicos no hub', () => {
  it('recusa horário ocupado e mantém a reserva antiga, segmentos e lembrete', async () => {
    const cookie = await login(),
      id = await book();
    await book(tomaz, '11:00');
    const before = await detail(id, cookie);
    const r = await post(tomaz, `/admin/bookings/${id}/reschedule`, action(1, at('10:50')), cookie);
    expect(r.status).toBe(409);
    expect(await detail(id, cookie)).toEqual(before);
    expect((await slots()).includes(at('10:00'))).toBe(false);
    const occupied = await env.DB.prepare(
      'SELECT starts_at FROM occupied_segments WHERE appointment_id=? ORDER BY starts_at',
    )
      .bind(id)
      .all<{ starts_at: number }>();
    expect(occupied.results.map((s) => s.starts_at)).toEqual([
      at('10:00'),
      at('10:10'),
      at('10:20'),
    ]);
    expect(
      (await env.DB.prepare('SELECT count(*) n FROM notification_outbox WHERE appointment_id=?')
        .bind(id)
        .first<{ n: number }>())!.n,
    ).toBe(1);
  });
  it('remarca com sobreposição do próprio horário, preserva snapshot e atualiza o lembrete', async () => {
    const cookie = await login(),
      id = await book();
    await env.DB.prepare(
      "UPDATE services SET price='R$ 99,00',duration=60 WHERE shop_id=? AND id='corte'",
    )
      .bind(tomaz)
      .run();
    const data = action(1, at('10:10'));
    const r = await post(tomaz, `/admin/bookings/${id}/reschedule`, data, cookie);
    expect(r.status).toBe(200);
    const d = await detail(id, cookie);
    expect(d.appointment).toMatchObject({
      starts_at: at('10:10'),
      ends_at: at('10:40'),
      duration_minutes: 30,
      price_label: 'R$ 30,00 no Pix ou dinheiro · R$ 33,00 no cartão',
      version: 2,
    });
    expect(d.events.map((e) => e.kind)).toEqual(['created', 'rescheduled']);
    expect(d.reminder).toEqual({ state: 'scheduled', due_at: at('10:00'), booking_version: 2 });
    expect(
      (await env.DB.prepare(
        'SELECT count(*) n FROM occupied_segments WHERE starts_at=? AND shop_id=?',
      )
        .bind(at('10:00'), tomaz)
        .first<{ n: number }>())!.n,
    ).toBe(0);
    expect((await post(tomaz, `/admin/bookings/${id}/reschedule`, data, cookie)).status).toBe(200);
    expect((await detail(id, cookie)).events).toHaveLength(2);
  });
  it('duas remarcações concorrentes para o mesmo intervalo confirmam uma só', async () => {
    const c = await login(),
      a = await book(),
      b = await book(tomaz, '11:00');
    const responses = await Promise.all([
      post(tomaz, `/admin/bookings/${a}/reschedule`, action(1, at('14:00')), c),
      post(tomaz, `/admin/bookings/${b}/reschedule`, action(1, at('14:00')), c),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const da = await detail(a, c),
      db = await detail(b, c);
    expect(
      [da.appointment.starts_at, db.appointment.starts_at].filter((t) => t === at('14:00')),
    ).toHaveLength(1);
    expect(
      da.appointment.starts_at === at('14:00')
        ? db.appointment.starts_at
        : da.appointment.starts_at,
    ).toBe(da.appointment.starts_at === at('14:00') ? at('11:00') : at('10:00'));
  });
  it('uma reserva nova e uma remarcação disputam o mesmo banco', async () => {
    const c = await login(),
      id = await book();
    const results = await Promise.all([
      post(tomaz, `/admin/bookings/${id}/reschedule`, action(1, at('14:00')), c),
      post(tomaz, '/bookings', booking('14:00')),
    ]);
    expect(results.filter((r) => r.status === 409)).toHaveLength(1);
    expect(results.filter((r) => r.status === 200 || r.status === 201)).toHaveLength(1);
    const d = await detail(id, c);
    expect(d.appointment.starts_at).toBe(results[0].status === 200 ? at('14:00') : at('10:00'));
  });
  it('cancela, libera a faixa e mantém registro, histórico e lembrete cancelado', async () => {
    const c = await login(),
      id = await book(),
      data = action();
    const responses = await Promise.all([
      post(tomaz, `/admin/bookings/${id}/cancel`, data, c),
      post(tomaz, `/admin/bookings/${id}/cancel`, data, c),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    const d = await detail(id, c);
    expect(d.appointment.status).toBe('cancelled');
    expect(d.appointment.cancelled_at).toBeTypeOf('number');
    expect(d.events.map((e) => e.kind)).toEqual(['created', 'cancelled']);
    expect(d.reminder).toEqual({ state: 'cancelled', due_at: null, booking_version: 2 });
    expect(await slots()).toContain(at('10:00'));
    const active = await get(tomaz, `/admin/bookings?date=${day}`, c);
    expect((await active.json<{ appointments: unknown[] }>()).appointments).toEqual([]);
    const history = await get(tomaz, `/admin/bookings?date=${day}&status=all`, c);
    expect(
      (await history.json<{ appointments: AppointmentRecord[] }>()).appointments[0].status,
    ).toBe('cancelled');
    await book(tomaz, '10:00');
    expect(
      (await post(tomaz, `/admin/bookings/${id}/reschedule`, action(2, at('12:00')), c)).status,
    ).toBe(409);
    const outbox = await env.DB.prepare(
      'SELECT kind,state FROM notification_outbox WHERE appointment_id=? ORDER BY booking_version',
    )
      .bind(id)
      .all();
    expect(outbox.results).toEqual([
      { kind: 'booking.created', state: 'pending_integration' },
      { kind: 'booking.cancelled', state: 'pending_integration' },
    ]);
  });
  it('cancelamento e remarcação simultâneos não se sobrescrevem', async () => {
    const c = await login(),
      id = await book();
    const results = await Promise.all([
      post(tomaz, `/admin/bookings/${id}/cancel`, action(), c),
      post(tomaz, `/admin/bookings/${id}/reschedule`, action(1, at('14:00')), c),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const d = await detail(id, c);
    expect(d.appointment.version).toBe(2);
    expect(d.events).toHaveLength(2);
  });
  it('suprime o lembrete quando faltam até dez minutos', async () => {
    const c = await login(),
      id = await book();
    const near = Math.floor(Date.now() / 600000) * 600 + 600;
    await env.DB.prepare(
      'UPDATE appointments SET starts_at=?,ends_at=?,version=version+1,action_key=?,action_fingerprint=? WHERE shop_id=? AND id=?',
    )
      .bind(near, near + 1800, crypto.randomUUID(), 'teste-do-trigger', tomaz, id)
      .run();
    expect((await detail(id, c)).reminder).toEqual({
      state: 'suppressed',
      due_at: null,
      booking_version: 2,
    });
  });
  it('não altera reserva do outro estabelecimento mesmo com sessão própria válida', async () => {
    const a = await login(),
      b = await login(aurora),
      id = await book(aurora);
    for (const kind of ['cancel', 'reschedule'])
      expect(
        (await post(tomaz, `/admin/bookings/${id}/${kind}`, action(1, at('14:00')), a)).status,
      ).toBe(404);
    expect((await post(aurora, `/admin/bookings/${id}/cancel`, action(), a)).status).toBe(401);
    expect((await detail(id, b, aurora)).appointment.status).toBe('confirmed');
  });
});

describe('expediente, pausas, exceções e restrições por estabelecimento', () => {
  it('edita a semana e pausas sem alterar o outro salão', async () => {
    const a = await login(),
      b = await login(aurora),
      original = await slots(aurora);
    const current = await config(tomaz, a);
    const days = current.days.map((d) => ({
      ...d,
      opensAt: 600,
      closesAt: 1020,
      breaks: d.enabled ? [{ startsAt: 720, endsAt: 780 }] : [],
    }));
    await save(tomaz, a, { kind: 'weekly', days });
    const s = await slots();
    expect(s[0]).toBe(at('10:00'));
    expect(s).not.toContain(at('11:40'));
    expect(s).not.toContain(at('12:00'));
    expect(s).toContain(at('13:00'));
    expect(s.at(-1)).toBe(at('16:30'));
    expect(await slots(aurora)).toEqual(original);
    expect((await config(aurora, b)).revision).toBe(0);
  });
  it('abre domingo excepcionalmente e restaura o padrão depois do período', async () => {
    const c = await login();
    let sunday = day;
    while (new Date(`${sunday}T12:00:00Z`).getUTCDay() !== 0) sunday = addDays(sunday, 1);
    expect(await slots(tomaz, sunday)).toEqual([]);
    const next = addDays(sunday, 1),
      before = await slots(tomaz, next);
    await save(tomaz, c, {
      kind: 'special',
      from: sunday,
      to: sunday,
      closed: false,
      opensAt: 360,
      closesAt: 840,
      breaks: [{ startsAt: 600, endsAt: 660 }],
    });
    expect((await slots(tomaz, sunday))[0]).toBe(at('06:00', sunday));
    expect(await slots(tomaz, sunday)).not.toContain(at('10:00', sunday));
    await book(tomaz, '06:00', sunday);
    expect(await slots(aurora, sunday)).toEqual([]);
    expect(await slots(tomaz, next)).toEqual(before);
  });
  it('horário de uma data tem prioridade sobre período mais amplo, com desempate pela criação mais recente', async () => {
    const c = await login(),
      end = addDays(day, 2);
    await save(tomaz, c, {
      kind: 'special',
      from: day,
      to: end,
      closed: false,
      opensAt: 600,
      closesAt: 900,
      breaks: [],
    });
    await save(tomaz, c, {
      kind: 'special',
      from: day,
      to: day,
      closed: false,
      opensAt: 360,
      closesAt: 720,
      breaks: [],
    });
    await save(tomaz, c, {
      kind: 'special',
      from: day,
      to: end,
      closed: false,
      opensAt: 660,
      closesAt: 960,
      breaks: [],
    });
    expect((await slots())[0]).toBe(at('06:00'));
    await save(tomaz, c, {
      kind: 'special',
      from: day,
      to: day,
      closed: true,
      opensAt: 0,
      closesAt: 1440,
      breaks: [],
    });
    expect(await slots()).toEqual([]);
  });
  it('faixa oculta fecha só o link e mantém o encaixe no hub', async () => {
    const c = await login();
    await save(tomaz, c, rule('online'));
    expect(await slots()).not.toContain(at('11:00'));
    expect(await slots()).not.toContain(at('10:40'));
    expect(await slots()).toContain(at('10:30'));
    expect(await slots()).toContain(at('12:00'));
    expect(await slots(tomaz, day, c)).toContain(at('11:00'));
    expect((await post(tomaz, '/bookings', booking('11:00'))).status).toBe(400);
    await book(tomaz, '11:00', day, c);
    expect(await slots(aurora)).toContain(at('11:00'));
  });
  it('bloqueio geral fecha os dois canais e pode ser removido para reabrir a faixa', async () => {
    const c = await login(),
      saved = await save(tomaz, c, rule('all'));
    expect(await slots()).not.toContain(at('11:00'));
    expect(await slots(tomaz, day, c)).not.toContain(at('11:00'));
    expect((await post(tomaz, '/bookings', booking('11:00'))).status).toBe(400);
    expect((await post(tomaz, '/admin/bookings', booking('11:00'), c)).status).toBe(400);
    expect(await slots(aurora)).toContain(at('11:00'));
    await save(tomaz, c, { kind: 'remove-rule', id: saved.rules[0].id });
    expect(await slots()).toContain(at('11:00'));
  });
  it('mostra reservas afetadas antes de salvar e as preserva depois', async () => {
    const c = await login(),
      a = await book(tomaz, '11:00', day, '', 'Cliente Online'),
      b = await book(tomaz, '13:00', day, c, 'Cliente Manual');
    await book(aurora, '11:00');
    const beforeA = await detail(a, c),
      beforeB = await detail(b, c);
    const p = await preview(tomaz, c, rule('all', 660, 840));
    expect(p.affected.map((a) => a.id).sort()).toEqual([a, b].sort());
    expect(await slots()).toContain(at('12:00'));
    const saved = await post(tomaz, '/admin/schedule/save', p, c);
    expect(saved.status).toBe(200);
    expect((await saved.json<ScheduleView>()).affected).toHaveLength(2);
    expect(await detail(a, c)).toEqual(beforeA);
    expect(await detail(b, c)).toEqual(beforeB);
    expect(await slots()).not.toContain(at('12:00'));
    expect(await slots(aurora)).toContain(at('12:00'));
  });
  it('faixa oculta indica somente as reservas feitas pelo canal online', async () => {
    const c = await login(),
      online = await book(tomaz, '11:00'),
      manual = await book(tomaz, '11:30', day, c);
    const p = await preview(tomaz, c, rule('online'));
    expect(p.affected.map((a) => a.id)).toEqual([online]);
    await post(tomaz, '/admin/schedule/save', p, c);
    const r = await post(
      tomaz,
      `/admin/bookings/${online}/reschedule`,
      action(1, at('11:00') - 600),
      c,
    );
    // 10h50 sobrepõe o próprio horário, mas também precisa respeitar o encaixe das 11h30.
    expect(r.status).toBe(200);
    expect((await detail(manual, c)).appointment.starts_at).toBe(at('11:30'));
    expect((await config(tomaz, c)).affected).toHaveLength(0);
  });
  it('remover abertura especial sinaliza os atendimentos que ficariam fora do padrão', async () => {
    const c = await login();
    let sunday = day;
    while (new Date(`${sunday}T12:00:00Z`).getUTCDay() !== 0) sunday = addDays(sunday, 1);
    const s = await save(tomaz, c, {
      kind: 'special',
      from: sunday,
      to: sunday,
      closed: false,
      opensAt: 540,
      closesAt: 720,
      breaks: [],
    });
    const id = await book(tomaz, '09:00', sunday);
    const p = await preview(tomaz, c, { kind: 'remove-special', id: s.specials[0].id });
    expect(p.affected.map((a) => a.id)).toEqual([id]);
    await post(tomaz, '/admin/schedule/save', p, c);
    expect((await detail(id, c)).appointment.status).toBe('confirmed');
  });
  it('prévia desatualizada por nova reserva exige nova revisão e não altera a configuração', async () => {
    const c = await login(),
      p = await preview(tomaz, c, rule('all'));
    await book(tomaz, '11:00');
    expect((await post(tomaz, '/admin/schedule/save', p, c)).status).toBe(409);
    expect((await config(tomaz, c)).rules).toEqual([]);
    const updated = await preview(tomaz, c, rule('all'));
    expect(updated.affected).toHaveLength(1);
  });
  it('mudança de agenda no Aurora não invalida prévia da TOMAZ', async () => {
    const c = await login(),
      p = await preview(tomaz, c, rule('all'));
    await book(aurora);
    expect((await post(tomaz, '/admin/schedule/save', p, c)).status).toBe(200);
  });
  it('salvar configuração e reservar simultaneamente não esconde uma reserva nova da prévia', async () => {
    const c = await login(),
      p = await preview(tomaz, c, rule('all'));
    const [saveResult, bookingResult] = await Promise.all([
      post(tomaz, '/admin/schedule/save', p, c),
      post(tomaz, '/bookings', booking('11:00')),
    ]);
    if (saveResult.status === 200) expect([400, 409]).toContain(bookingResult.status);
    else {
      expect(saveResult.status).toBe(409);
      expect(bookingResult.status).toBe(201);
    }
  });
  it('duas configurações simultâneas não causam salvamento parcial; reenvio não duplica regras', async () => {
    const c = await login(),
      a = await preview(tomaz, c, rule('online')),
      b = await preview(tomaz, c, rule('all', 900, 960));
    const results = await Promise.all([
      post(tomaz, '/admin/schedule/save', a, c),
      post(tomaz, '/admin/schedule/save', b, c),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = results[0].status === 200 ? a : b;
    expect((await post(tomaz, '/admin/schedule/save', winner, c)).status).toBe(200);
    expect((await config(tomaz, c)).rules).toHaveLength(1);
  });
  it('a configuração e a remoção de regras são restritas ao estabelecimento da sessão', async () => {
    const a = await login(),
      b = await login(aurora),
      other = await save(aurora, b, rule('all'));
    expect((await get(aurora, '/admin/schedule', a)).status).toBe(401);
    expect(
      (
        await post(
          aurora,
          '/admin/schedule/preview',
          { command: rule('all'), expectedRevision: 1 },
          a,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await post(
          tomaz,
          '/admin/schedule/preview',
          { command: { kind: 'remove-rule', id: other.rules[0].id }, expectedRevision: 0 },
          a,
        )
      ).status,
    ).toBe(404);
    expect((await config(aurora, b)).rules).toHaveLength(1);
  });
  it('valida pausas, horários, datas e exige prévia antes de salvar', async () => {
    const c = await login(),
      current = await config(tomaz, c);
    const days = current.days.map((d) => ({
      ...d,
      enabled: true,
      breaks: [
        { startsAt: 720, endsAt: 780 },
        { startsAt: 750, endsAt: 800 },
      ],
    }));
    expect(
      (
        await post(
          tomaz,
          '/admin/schedule/preview',
          { command: { kind: 'weekly', days }, expectedRevision: 0 },
          c,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await post(
          tomaz,
          '/admin/schedule/preview',
          { command: rule('all', 665, 720), expectedRevision: 0 },
          c,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await post(
          tomaz,
          '/admin/schedule/preview',
          { command: { ...rule('all'), to: '2026-02-30' }, expectedRevision: 0 },
          c,
        )
      ).status,
    ).toBe(400);
    expect(
      (await post(tomaz, '/admin/schedule/save', { command: rule('all'), expectedRevision: 0 }, c))
        .status,
    ).toBe(400);
    expect((await config(tomaz, c)).revision).toBe(0);
  });
});

it('reenvio da criação após cancelamento não confirma uma reserva cancelada', async () => {
  const c = await login(),
    data = booking();
  const created = await post(tomaz, '/bookings', data);
  expect(created.status).toBe(201);
  const id = (await created.json<{ appointment: { id: string } }>()).appointment.id;
  expect((await post(tomaz, `/admin/bookings/${id}/cancel`, action(), c)).status).toBe(200);
  expect((await post(tomaz, '/bookings', data)).status).toBe(409);
  expect((await detail(id, c)).appointment.status).toBe('cancelled');
});
it('remarcação no hub respeita bloqueio geral e pode usar faixa oculta', async () => {
  const c = await login(),
    id = await book();
  const blocked = await save(tomaz, c, rule('all'));
  expect(
    (await post(tomaz, `/admin/bookings/${id}/reschedule`, action(1, at('11:00')), c)).status,
  ).toBe(400);
  expect((await detail(id, c)).appointment.starts_at).toBe(at('10:00'));
  await save(tomaz, c, { kind: 'remove-rule', id: blocked.rules[0].id });
  await save(tomaz, c, rule('online'));
  expect(
    (await post(tomaz, `/admin/bookings/${id}/reschedule`, action(1, at('11:00')), c)).status,
  ).toBe(200);
  expect((await detail(id, c)).appointment.booking_channel).toBe('hub');
  expect((await config(tomaz, c)).affected).toEqual([]);
});
