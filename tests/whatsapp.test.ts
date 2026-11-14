import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker, { type Env } from '../src/server';
import { addDays, localDate } from '../src/shared';
import { decrypt, hmac, type TemplatePayload } from '../src/server/whatsapp/meta';
import {
  dispatch,
  processWhatsApp,
  stageEvents,
  stageReminders,
  testMessage,
  type Delivery,
} from '../src/server/whatsapp/queue';
const base = 'https://tomaz.test',
  shop = 'tomaz-barber',
  aurora = 'salao-aurora',
  phone = '+5575999990500';
let day = addDays(localDate(), 3);
while ([0, 1].includes(new Date(`${day}T12:00:00Z`).getUTCDay())) day = addDays(day, 1);
const at = (time: string) => Date.parse(`${day}T${time}:00-03:00`) / 1000;
let posted: TemplatePayload[] = [],
  behavior: (message: TemplatePayload) => Promise<Response>;
const transport = {
  async fetch(request: Request) {
    expect(new URL(request.url).host).toBe('graph.facebook.com');
    expect(request.headers.get('Authorization')).toBe('Bearer token-ficticio-exclusivo-dos-testes');
    const p = await request.json<TemplatePayload>();
    posted.push(p);
    return behavior(p);
  },
} as unknown as Fetcher;
const settings = (): Env => ({
  ...env,
  CUSTOMER_AUTH_SECRET: 'segredo-de-sessao-ficticio-exclusivo-dos-testes',
  WHATSAPP_MODE: 'test',
  WHATSAPP_TEST_RECIPIENT: phone,
  WHATSAPP_ENABLED_SINCE: '2020-01-01T00:00:00Z',
  WHATSAPP_PUBLIC_BASE_URL: base,
  WHATSAPP_GRAPH_VERSION: 'v27.0',
  WHATSAPP_PHONE_NUMBER_ID: '111111111111',
  WHATSAPP_WABA_ID: '222222222222',
  WHATSAPP_ACCESS_TOKEN: 'token-ficticio-exclusivo-dos-testes',
  WHATSAPP_APP_SECRET: 'app-secret-ficticio-exclusivo-dos-testes-123',
  WHATSAPP_VERIFY_TOKEN: 'verify-token-ficticio-exclusivo-dos-testes-123',
  WHATSAPP_PAYLOAD_SECRET: 'payload-secret-ficticio-exclusivo-dos-testes-123',
  WHATSAPP_HTTP: transport,
});
function request(path: string, data?: unknown, cookie = '', s = shop) {
  return new Request(`${base}/api/shops/${s}${path}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json', Cookie: cookie },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
}
const api = (path: string, data?: unknown, cookie = '', s = shop, e = settings()) =>
  worker.fetch(request(path, data, cookie, s), e);
async function login(s = shop) {
  const r = await SELF.fetch(
    request('/admin/login', { password: JSON.parse(env.ADMIN_PASSWORDS!)[s] }, '', s),
  );
  expect(r.status).toBe(200);
  return r.headers.get('Set-Cookie')!.split(';')[0];
}
async function book(time = '10:00', manual = false, s = shop, recipient = phone) {
  const cookie = manual ? await login(s) : '';
  const r = await SELF.fetch(
    request(
      manual ? '/admin/bookings' : '/bookings',
      {
        name: 'Cliente Fictício',
        phone: recipient,
        serviceId: 'corte',
        startsAt: at(time),
        requestKey: crypto.randomUUID(),
      },
      cookie,
      s,
    ),
  );
  expect(r.status).toBe(201);
  return (await r.json<{ appointment: { id: string } }>()).appointment.id;
}
async function delivery(kind: string, appointmentId?: string) {
  return (await env.DB.prepare(
    `SELECT * FROM whatsapp_deliveries WHERE kind=?${appointmentId ? ' AND appointment_id=?' : ''} ORDER BY created_at DESC,rowid DESC LIMIT 1`,
  )
    .bind(kind, ...(appointmentId ? [appointmentId] : []))
    .first<Delivery>())!;
}
async function due(id: string) {
  await env.DB.prepare('UPDATE whatsapp_deliveries SET next_attempt_at=unixepoch()-1 WHERE id=?')
    .bind(id)
    .run();
}
const action = (version = 1, startsAt?: number) => ({
  requestKey: crypto.randomUUID(),
  expectedVersion: version,
  ...(startsAt !== undefined ? { startsAt } : {}),
});
async function change(id: string, kind: string, version = 1, startsAt?: number) {
  return api(`/admin/bookings/${id}/${kind}`, action(version, startsAt), await login());
}
async function callback(
  payload: TemplatePayload,
  status = 'delivered',
  overrides: Record<string, unknown> = {},
  e = settings(),
) {
  const message = {
    id: 'wamid.callback-accepted',
    status,
    recipient_id: phone.slice(1),
    timestamp: '1790000000',
    biz_opaque_callback_data: payload.biz_opaque_callback_data,
    ...overrides,
  };
  const raw = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: settings().WHATSAPP_WABA_ID,
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: settings().WHATSAPP_PHONE_NUMBER_ID },
              statuses: [message],
            },
          },
        ],
      },
    ],
  });
  const signature = await hmac(e.WHATSAPP_APP_SECRET!, new TextEncoder().encode(raw));
  return worker.fetch(
    new Request(`${base}/webhooks/whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': `sha256=${signature}` },
      body: raw,
    }),
    e,
  );
}
beforeEach(() => {
  posted = [];
  behavior = async () => Response.json({ messages: [{ id: `wamid.${crypto.randomUUID()}` }] });
});

describe('código, destinatário autorizado e fila Meta', () => {
  it('envia o código por modelo de autenticação, mantém sessão de 24h e não devolve o código na API', async () => {
    const start = await api('/customer/verification', { phone });
    expect(start.status).toBe(201);
    const data = await start.json<{ challengeId: string }>();
    expect(data).not.toHaveProperty('code');
    expect(posted).toHaveLength(1);
    const p = posted[0];
    expect(p.to).toBe(phone.slice(1));
    expect(p.template.name).toBe('tomaz_acesso_v1');
    expect(p.template.language.code).toBe('pt_BR');
    const components = p.template.components as {
      type: string;
      sub_type?: string;
      parameters: { text: string }[];
    }[];
    const code = components[0].parameters[0].text;
    expect(code).toMatch(/^\d{6}$/);
    expect(components[1]).toMatchObject({
      type: 'button',
      sub_type: 'url',
      parameters: [{ type: 'text', text: code }],
    });
    const finish = await api('/customer/verify', { challengeId: data.challengeId, code });
    expect(finish.status).toBe(200);
    expect(finish.headers.get('Set-Cookie')).toContain('Max-Age=86400');
    const d = await delivery('access_code');
    expect(d.state).toBe('accepted');
    expect(d.payload).toBeNull();
    await processWhatsApp(settings());
    expect(posted).toHaveLength(1);
  });
  it('mantém o código criptografado quando a Meta rejeita por limite e tenta depois sem duplicar', async () => {
    behavior = async () =>
      Response.json({ error: { code: 130429 } }, { status: 429, headers: { 'Retry-After': '90' } });
    const start = await api('/customer/verification', { phone });
    expect(start.status).toBe(201);
    const code = (posted[0].template.components![0] as { parameters: { text: string }[] })
      .parameters[0].text;
    let d = await delivery('access_code');
    expect(d.state).toBe('retry');
    expect(d.payload).not.toContain(code);
    expect(d.iv).toHaveLength(24);
    expect((await decrypt(settings(), d.payload!, d.iv!, d.id)).template.name).toBe(
      'tomaz_acesso_v1',
    );
    expect(d.next_attempt_at - Math.floor(Date.now() / 1000)).toBeGreaterThanOrEqual(88);
    await processWhatsApp(settings());
    expect(posted).toHaveLength(1);
    behavior = async () => Response.json({ messages: [{ id: 'wamid.code-retry' }] });
    await due(d.id);
    await processWhatsApp(settings());
    await processWhatsApp(settings());
    d = await delivery('access_code');
    expect(d.state).toBe('accepted');
    expect(d.attempts).toBe(2);
    expect(posted).toHaveLength(2);
  });
  it('não envia código expirado ou substituído e não usa o remetente da TOMAZ no Aurora', async () => {
    behavior = async () => Response.json({ error: { code: 130429 } }, { status: 429 });
    const r = await api('/customer/verification', { phone });
    expect(r.status).toBe(201);
    const d = await delivery('access_code');
    await env.DB.prepare('UPDATE phone_challenges SET invalidated_at=unixepoch()').run();
    await due(d.id);
    await processWhatsApp(settings());
    expect((await delivery('access_code')).state).toBe('suppressed');
    expect(posted).toHaveLength(1);
    expect((await api('/customer/verification', { phone }, '', aurora)).status).toBe(503);
    expect(posted).toHaveLength(1);
  });
  it('ignora modo off/live e destinatários diferentes, sem redirecionar dados para o telefone de teste', async () => {
    await book('10:00', false, shop, '75999995555');
    await book('10:00', false, aurora);
    await processWhatsApp({ ...settings(), WHATSAPP_MODE: 'off' });
    await processWhatsApp({ ...settings(), WHATSAPP_MODE: 'live' });
    expect(posted).toHaveLength(0);
    await processWhatsApp(settings());
    expect(posted).toHaveLength(0);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM whatsapp_deliveries').first('n')).toBe(
      0,
    );
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS n FROM whatsapp_processed_events WHERE outcome='outside_test'",
      ).first('n'),
    ).toBe(1);
    expect((await api('/customer/verification', { phone: '75999995555' })).status).toBe(503);
  });
  it('não envia eventos anteriores à ativação nem retroativos ao configurar o piloto', async () => {
    await book();
    await processWhatsApp({
      ...settings(),
      WHATSAPP_ENABLED_SINCE: new Date(Date.now() + 3600000).toISOString(),
    });
    expect(posted).toHaveLength(0);
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS n FROM whatsapp_processed_events WHERE outcome='before_activation'",
      ).first('n'),
    ).toBe(1);
  });
  it('falha fechada sem configuração ou segredo e nunca depende de credenciais no frontend', async () => {
    await expect(
      processWhatsApp({ ...settings(), WHATSAPP_PAYLOAD_SECRET: undefined }),
    ).rejects.toThrow();
    expect(posted).toHaveLength(0);
    const r = await api('/admin/whatsapp', undefined, await login());
    expect(r.status).toBe(200);
    const text = await r.text();
    for (const value of [
      'token-ficticio-exclusivo-dos-testes',
      'app-secret-ficticio',
      'payload-secret-ficticio',
    ])
      expect(text).not.toContain(value);
  });
});

describe('confirmações, lembretes e alterações da reserva', () => {
  it('confirma tanto reservas pelo link quanto pelo hub no número cadastrado, uma vez por evento', async () => {
    const a = await book(),
      b = await book('11:00', true);
    await processWhatsApp(settings());
    await processWhatsApp(settings());
    expect(posted).toHaveLength(2);
    expect(posted.every((p) => p.to === phone.slice(1))).toBe(true);
    expect(posted.every((p) => p.template.name === 'tomaz_reserva_confirmada_v1')).toBe(true);
    expect((await delivery('confirmation', a)).state).toBe('accepted');
    expect((await delivery('confirmation', b)).state).toBe('accepted');
    const param = JSON.stringify(posted[0]);
    expect(param).toContain('/s/tomaz-barber/meus-horarios');
    expect(param).toContain('Corte masculino');
  });
  it('programa o lembrete para dez minutos antes e só envia quando vence e a confirmação foi aceita', async () => {
    const id = await book();
    await processWhatsApp(settings());
    expect(posted).toHaveLength(1);
    const reminder = await env.DB.prepare(
      'SELECT due_at FROM appointment_reminders WHERE appointment_id=?',
    )
      .bind(id)
      .first<{ due_at: number }>();
    expect(reminder!.due_at).toBe(at('10:00') - 600);
    await stageReminders(settings(), reminder!.due_at - 1);
    expect(await delivery('reminder')).toBeNull();
    await stageReminders(settings(), reminder!.due_at);
    const d = await delivery('reminder');
    expect(d.next_attempt_at).toBe(reminder!.due_at);
    await dispatch(settings(), d.id, reminder!.due_at - 1);
    expect(posted).toHaveLength(1);
    await dispatch(settings(), d.id, reminder!.due_at);
    await dispatch(settings(), d.id, reminder!.due_at);
    expect(posted).toHaveLength(2);
    expect(posted[1].template.name).toBe('tomaz_lembrete_10min_v1');
  });
  it('reserva feita com dez minutos ou menos recebe só confirmação', async () => {
    const id = crypto.randomUUID(),
      customer = crypto.randomUUID(),
      start = Math.ceil((Date.now() / 1000 + 1) / 600) * 600;
    await env.DB.batch([
      env.DB.prepare('INSERT INTO customers(shop_id,id,full_name,phone) VALUES (?,?,?,?)').bind(
        shop,
        customer,
        'Cliente Fictício',
        phone,
      ),
      env.DB.prepare(
        "INSERT INTO appointments(id,shop_id,professional_id,customer_id,request_key,request_fingerprint,origin,customer_name,customer_phone,service_id,service_name,price_label,duration_minutes,starts_at,ends_at,schedule_revision,booking_channel) SELECT ?,?,'principal',?,?,'fixture-clock-boundary','link','Cliente Fictício',?,id,name,price,duration,?,?+duration*60,0,'link' FROM services WHERE shop_id=? AND id='corte'",
      ).bind(id, shop, customer, crypto.randomUUID(), phone, start, start, shop),
    ]);
    expect(
      await env.DB.prepare('SELECT state FROM appointment_reminders WHERE appointment_id=?')
        .bind(id)
        .first('state'),
    ).toBe('suppressed');
    await processWhatsApp(settings());
    expect(posted).toHaveLength(1);
    expect(posted[0].template.name).toBe('tomaz_reserva_confirmada_v1');
    expect((await delivery('confirmation', id)).expires_at).toBeGreaterThanOrEqual(
      Math.floor(Date.now() / 1000) + 590,
    );
    await stageReminders(settings(), start - 1);
    expect(await delivery('reminder')).toBeNull();
  });
  it('não envia lembrete atrasado, nem antes da confirmação aceita', async () => {
    const id = await book();
    const dueAt = at('10:00') - 600;
    await stageEvents(settings());
    await stageReminders(settings(), dueAt);
    const d = await delivery('reminder');
    await dispatch(settings(), d.id, dueAt);
    expect(posted).toHaveLength(0);
    await stageReminders(settings(), dueAt + 121);
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS n FROM whatsapp_deliveries WHERE kind='reminder' AND appointment_id=?",
      )
        .bind(id)
        .first('n'),
    ).toBe(1);
    await dispatch(settings(), d.id, dueAt + 121);
    expect(posted).toHaveLength(0);
  });
  it('remarca confirma o novo horário e substitui o lembrete sem disparar o antigo', async () => {
    const id = await book();
    await processWhatsApp(settings());
    const oldDue = at('10:00') - 600;
    await stageReminders(settings(), oldDue);
    const old = await delivery('reminder', id);
    expect((await change(id, 'reschedule', 1, at('12:00'))).status).toBe(200);
    expect(
      await env.DB.prepare('SELECT state FROM whatsapp_deliveries WHERE id=?')
        .bind(old.id)
        .first('state'),
    ).toBe('suppressed');
    await processWhatsApp(settings());
    expect(posted).toHaveLength(2);
    expect(posted[1].template.name).toBe('tomaz_reserva_remarcada_v1');
    expect(JSON.stringify(posted[1])).toContain('12:00');
    await dispatch(settings(), old.id, oldDue);
    expect(posted).toHaveLength(2);
    const newDue = at('12:00') - 600;
    await stageReminders(settings(), newDue);
    const next = await delivery('reminder', id);
    expect(next.id).not.toBe(old.id);
    expect(next.booking_version).toBe(2);
    await dispatch(settings(), next.id, newDue);
    expect(posted).toHaveLength(3);
  });
  it('cancelar confirma o cancelamento, retira o lembrete e não perde histórico', async () => {
    const id = await book();
    await processWhatsApp(settings());
    const dueAt = at('10:00') - 600;
    await stageReminders(settings(), dueAt);
    const reminder = await delivery('reminder', id);
    expect((await change(id, 'cancel')).status).toBe(200);
    await processWhatsApp(settings());
    await dispatch(settings(), reminder.id, dueAt);
    expect(posted.map((p) => p.template.name)).toEqual([
      'tomaz_reserva_confirmada_v1',
      'tomaz_reserva_cancelada_v1',
    ]);
    expect(
      await env.DB.prepare('SELECT state FROM appointment_reminders WHERE appointment_id=?')
        .bind(id)
        .first('state'),
    ).toBe('cancelled');
    expect(
      await env.DB.prepare('SELECT count(*) AS n FROM booking_events WHERE appointment_id=?')
        .bind(id)
        .first('n'),
    ).toBe(2);
  });
  it('confirma só o estado atual quando a criação foi alterada antes do processamento', async () => {
    const id = await book();
    expect((await change(id, 'reschedule', 1, at('12:00'))).status).toBe(200);
    expect((await change(id, 'cancel', 2)).status).toBe(200);
    await processWhatsApp(settings());
    expect(posted).toHaveLength(1);
    expect(posted[0].template.name).toBe('tomaz_reserva_cancelada_v1');
  });
});

describe('falhas, concorrência e confirmação do provedor', () => {
  it('dois consumidores disputam a mesma mensagem e somente um chama a Meta', async () => {
    const id = await book();
    await stageEvents(settings());
    const d = await delivery('confirmation', id);
    await Promise.all([dispatch(settings(), d.id), dispatch(settings(), d.id)]);
    expect(posted).toHaveLength(1);
    expect((await delivery('confirmation', id)).attempts).toBe(1);
  });
  it('rejeição 429 permite nova tentativa após espera, sem repetir mensagem aceita', async () => {
    const id = await book();
    behavior = async () => Response.json({ error: { code: 130429 } }, { status: 429 });
    await processWhatsApp(settings());
    const d = await delivery('confirmation', id);
    expect(d.state).toBe('retry');
    await processWhatsApp(settings());
    expect(posted).toHaveLength(1);
    behavior = async () => Response.json({ messages: [{ id: 'wamid.retry-accepted' }] });
    await due(d.id);
    await processWhatsApp(settings());
    await processWhatsApp(settings());
    expect(posted).toHaveLength(2);
    expect((await delivery('confirmation', id)).state).toBe('accepted');
  });
  it('interrompe novas tentativas após cinco rejeições explícitas', async () => {
    const id = await book();
    behavior = async () => Response.json({ error: { code: 130429 } }, { status: 429 });
    for (let n = 0; n < 6; n++) {
      await processWhatsApp(settings());
      const d = await delivery('confirmation', id);
      await due(d.id);
    }
    expect(posted).toHaveLength(5);
    expect((await delivery('confirmation', id)).state).toBe('failed');
  });
  it('timeout e 5xx ficam incertos e não geram outro POST automático', async () => {
    const a = await book(),
      b = await book('11:00');
    let count = 0;
    behavior = async () => {
      if (count++ === 0) throw new Error('rede interrompida');
      return Response.json({ error: { code: 131000 } }, { status: 500 });
    };
    await processWhatsApp(settings());
    await processWhatsApp(settings());
    expect(posted).toHaveLength(2);
    expect((await delivery('confirmation', a)).state).toBe('unknown');
    expect((await delivery('confirmation', b)).state).toBe('unknown');
  });
  it('worker interrompido após adquirir lease fica incerto e não é reenviado', async () => {
    const id = await book();
    await stageEvents(settings());
    const d = await delivery('confirmation', id),
      token = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE whatsapp_deliveries SET state='sending',attempts=1,claim_token=?,lease_expires_at=unixepoch()-1 WHERE id=?",
      ).bind(token, d.id),
      env.DB.prepare(
        "INSERT INTO whatsapp_attempts(token,delivery_id,attempt,state) VALUES (?,?,1,'started')",
      ).bind(token, d.id),
    ]);
    await processWhatsApp(settings());
    expect(posted).toHaveLength(0);
    expect((await delivery('confirmation', id)).state).toBe('unknown');
  });
  it('webhook concilia envio incerto; duplicado ou fora de ordem não duplica nem rebaixa entrega', async () => {
    const id = await book();
    behavior = async () => {
      throw new Error('resposta perdida depois de aceitar');
    };
    await processWhatsApp(settings());
    const p = posted[0];
    expect((await delivery('confirmation', id)).state).toBe('unknown');
    expect((await callback(p)).status).toBe(200);
    expect((await callback(p)).status).toBe(200);
    expect((await callback(p, 'sent')).status).toBe(200);
    expect((await callback(p, 'failed', { errors: [{ code: 131026 }] })).status).toBe(200);
    const d = await delivery('confirmation', id);
    expect(d.state).toBe('delivered');
    expect(d.provider_id).toBe('wamid.callback-accepted');
    await processWhatsApp(settings());
    expect(posted).toHaveLength(1);
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS n FROM whatsapp_webhook_events WHERE delivery_id=? AND status='delivered'",
      )
        .bind(d.id)
        .first('n'),
    ).toBe(1);
  });
  it('confirmação chega pelo webhook antes da resposta do POST sem ser rebaixada para aceita', async () => {
    const id = await book();
    behavior = async (p) => {
      expect((await callback(p, 'read')).status).toBe(200);
      return Response.json({ messages: [{ id: 'wamid.callback-accepted' }] });
    };
    await processWhatsApp(settings());
    expect((await delivery('confirmation', id)).state).toBe('read');
    expect(posted).toHaveLength(1);
  });
  it('assinatura inválida, número remetente, WABA e destinatário errados não alteram estado', async () => {
    const id = await book();
    await processWhatsApp(settings());
    const p = posted[0];
    expect(
      (
        await worker.fetch(
          new Request(`${base}/webhooks/whatsapp`, { method: 'POST', body: '{}' }),
          settings(),
        )
      ).status,
    ).toBe(401);
    const providerId = (await delivery('confirmation', id)).provider_id;
    await callback(p, 'delivered', { id: providerId, recipient_id: '5575999999999' });
    await callback(
      p,
      'delivered',
      { id: providerId },
      { ...settings(), WHATSAPP_WABA_ID: '999999999' },
    );
    await callback(
      p,
      'delivered',
      { id: providerId },
      { ...settings(), WHATSAPP_PHONE_NUMBER_ID: '999999999' },
    );
    expect((await delivery('confirmation', id)).state).toBe('accepted');
    await callback(p, 'delivered', { id: providerId });
    expect((await delivery('confirmation', id)).state).toBe('delivered');
    const check = await worker.fetch(
      new Request(
        `${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${settings().WHATSAPP_VERIFY_TOKEN}&hub.challenge=12345`,
      ),
      settings(),
    );
    expect(check.status).toBe(200);
    expect(await check.text()).toBe('12345');
  });
  it('bloqueia remarcação e cancelamento durante envio em voo e permite depois, preservando a reserva', async () => {
    const id = await book();
    let finish!: (r: Response) => void;
    let arrived!: () => void;
    const sending = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    behavior = async () => {
      arrived();
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    };
    const process = processWhatsApp(settings());
    await sending;
    expect((await change(id, 'reschedule', 1, at('12:00'))).status).toBe(409);
    expect((await change(id, 'cancel')).status).toBe(409);
    expect(
      await env.DB.prepare('SELECT starts_at FROM appointments WHERE id=?')
        .bind(id)
        .first('starts_at'),
    ).toBe(at('10:00'));
    finish(Response.json({ messages: [{ id: 'wamid.inflight' }] }));
    await process;
    expect((await change(id, 'reschedule', 1, at('12:00'))).status).toBe(200);
  });
  it('hub repete só rejeição definitiva, autentica e respeita estabelecimento e idempotência', async () => {
    const id = await book();
    behavior = async () => Response.json({ error: { code: 132001 } }, { status: 400 });
    await processWhatsApp(settings());
    const d = await delivery('confirmation', id);
    expect(d.state).toBe('failed');
    const cookie = await login(),
      data = { requestKey: crypto.randomUUID() };
    expect((await api(`/admin/whatsapp/${d.id}/retry`, data)).status).toBe(401);
    expect(
      (await api(`/admin/whatsapp/${d.id}/retry`, data, await login(aurora), aurora)).status,
    ).toBe(404);
    const retries = await Promise.all([
      api(`/admin/whatsapp/${d.id}/retry`, data, cookie),
      api(`/admin/whatsapp/${d.id}/retry`, data, cookie),
    ]);
    expect(retries.map((r) => r.status)).toEqual([200, 200]);
    behavior = async () => Response.json({ messages: [{ id: 'wamid.manual-retry' }] });
    await processWhatsApp({
      ...settings(),
      WHATSAPP_TEMPLATE_CONFIRMATION: 'tomaz_confirmacao_aprovada_v2',
    });
    expect(posted).toHaveLength(2);
    expect(posted[1].template.name).toBe('tomaz_confirmacao_aprovada_v2');
    expect(
      (await api(`/admin/whatsapp/${d.id}/retry`, { requestKey: crypto.randomUUID() }, cookie))
        .status,
    ).toBe(409);
  });
  it('probe real é restrito ao número configurado e deduplica o mesmo pedido', async () => {
    const data = { requestKey: crypto.randomUUID() },
      s = (await import('../src/server/shops')).getShop;
    const tomaz = await s(env.DB, shop);
    const a = await testMessage(settings(), tomaz, data),
      b = await testMessage(settings(), tomaz, data);
    expect(a.id).toBe(b.id);
    expect(posted).toHaveLength(1);
    expect(posted[0].template.name).toBe('hello_world');
  });
});
