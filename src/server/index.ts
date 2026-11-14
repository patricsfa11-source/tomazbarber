import { localDate, type Shop } from '../shared';
import {
  getSchedule,
  scheduleCandidates,
  scheduleView,
  previewSchedule,
  saveSchedule,
} from './schedule-management';
import {
  appointmentColumns,
  getAppointment,
  appointmentDetail,
  mutateAppointment,
} from './appointments';
import { hash } from './crypto';
import { firstShop, getShop, getService, getServices, primaryProfessional } from './shops';
import { ApiError, available, dayBounds, validateDate } from './schedule';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_PASSWORD?: string;
  ADMIN_PASSWORDS?: string;
}
interface BookingInput {
  serviceId: string;
  startsAt: number;
  name: string;
  phone: string;
  requestKey: string;
}
interface Appointment {
  id: string;
  request_fingerprint: string;
  service_name: string;
  price_label: string;
  duration_minutes: number;
  starts_at: number;
  ends_at: number;
  origin: string;
  status: string;
  version: number;
}
const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
  });
function receipt(a: Appointment) {
  return {
    id: a.id,
    status: a.status,
    version: a.version,
    service: a.service_name,
    price: a.price_label,
    duration: a.duration_minutes,
    startsAt: a.starts_at,
    endsAt: a.ends_at,
  };
}
async function body(request: Request, maxBytes = 4096): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new ApiError(415, 'Envie os dados em JSON.');
  // Limite também durante a leitura: Content-Length pode estar ausente.
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'Preencha os dados da solicitação.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new ApiError(413, 'Solicitação muito grande.');
    }
    chunks.push(value);
  }
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'Dados inválidos. Confira e tente novamente.');
  }
}
function passwordFor(env: Env, shop: Shop): string | undefined {
  let password: unknown;
  if (env.ADMIN_PASSWORDS !== undefined) {
    try {
      const passwords: unknown = JSON.parse(env.ADMIN_PASSWORDS);
      if (!passwords || typeof passwords !== 'object' || Array.isArray(passwords)) return;
      password = Object.hasOwn(passwords, shop.slug)
        ? (passwords as Record<string, unknown>)[shop.slug]
        : undefined;
    } catch {
      return;
    }
  } else if (shop.id === firstShop) password = env.ADMIN_PASSWORD;
  return typeof password === 'string' && password.length >= 20 && password.length <= 200
    ? password
    : undefined;
}
const sessionToken = (request: Request) =>
  request.headers.get('Cookie')?.match(/(?:^|;\s*)tb_session=([a-f0-9]{64})(?:;|$)/)?.[1];
async function requireAdmin(request: Request, env: Env, shop: Shop) {
  const token = sessionToken(request);
  if (!token || !passwordFor(env, shop))
    throw new ApiError(401, 'Entre no hub deste estabelecimento para continuar.');
  const session = await env.DB.prepare(
    'SELECT expires_at FROM admin_sessions WHERE token_hash = ? AND shop_id = ? AND expires_at > unixepoch()',
  )
    .bind(await hash(token), shop.id)
    .first();
  if (!session)
    throw new ApiError(401, 'Sua sessão não dá acesso a este estabelecimento. Entre novamente.');
}
function cookie(request: Request, token: string, maxAge: number, adminPath: string) {
  return `tb_session=${token}; HttpOnly; SameSite=Strict; Path=${adminPath}; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
async function login(request: Request, env: Env, shop: Shop, adminPath: string) {
  const password = passwordFor(env, shop);
  if (!password)
    throw new ApiError(
      503,
      'Configure o acesso administrativo deste estabelecimento no ambiente local.',
    );
  const data = await body(request);
  const bucket = await hash(
    `${shop.id}:${request.headers.get('CF-Connecting-IP') || 'local'}:${Math.floor(Date.now() / 900000)}`,
  );
  const attempt = await env.DB.prepare(
    'INSERT INTO login_attempts (bucket,attempts,expires_at) VALUES (?,1,unixepoch()+900) ON CONFLICT(bucket) DO UPDATE SET attempts = attempts + 1 RETURNING attempts',
  )
    .bind(bucket)
    .first<{ attempts: number }>();
  if (!attempt || attempt.attempts > 10)
    throw new ApiError(429, 'Muitas tentativas. Aguarde 15 minutos.');
  if (
    typeof data.password !== 'string' ||
    data.password.length > 200 ||
    (await hash(data.password)) !== (await hash(password))
  )
    throw new ApiError(401, 'Senha incorreta.');
  const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  await env.DB.batch([
    env.DB.prepare(
      'DELETE FROM admin_sessions WHERE shop_id = ? AND expires_at <= unixepoch()',
    ).bind(shop.id),
    env.DB.prepare(
      'INSERT INTO admin_sessions (token_hash,shop_id,expires_at) VALUES (?,?,unixepoch()+28800)',
    ).bind(await hash(token), shop.id),
  ]);
  return json({ ok: true, shopId: shop.id }, 200, {
    'Set-Cookie': cookie(request, token, 28800, adminPath),
  });
}
function parseBooking(data: Record<string, unknown>): BookingInput {
  if (
    typeof data.name !== 'string' ||
    typeof data.phone !== 'string' ||
    typeof data.serviceId !== 'string' ||
    typeof data.startsAt !== 'number' ||
    !Number.isSafeInteger(data.startsAt) ||
    typeof data.requestKey !== 'string' ||
    !/^[a-f0-9-]{36}$/i.test(data.requestKey)
  )
    throw new ApiError(400, 'Confira os dados da reserva.');
  const name = data.name.trim().replace(/\s+/g, ' ');
  if (
    name.length < 5 ||
    name.length > 100 ||
    !/^\p{L}[\p{L}\p{M}'’-]+(?: [\p{L}\p{M}'’-]+)+$/u.test(name)
  )
    throw new ApiError(400, 'Informe seu nome completo.');
  let phone = data.phone.replace(/\D/g, '');
  if (phone.length === 12 || phone.length === 13) {
    if (phone.startsWith('55')) phone = phone.slice(2);
  }
  if (!/^[1-9]{2}(?:9\d{8}|[2-5]\d{7})$/.test(phone))
    throw new ApiError(400, 'Informe um telefone brasileiro com DDD.');
  return {
    name,
    phone: `+55${phone}`,
    serviceId: data.serviceId,
    startsAt: data.startsAt,
    requestKey: data.requestKey,
  };
}
async function book(request: Request, env: Env, shop: Shop, origin: 'link' | 'hub') {
  const input = parseBooking(await body(request));
  const fingerprint = await hash(JSON.stringify({ ...input, origin }));
  const existing = () =>
    env.DB.prepare('SELECT * FROM appointments WHERE shop_id = ? AND request_key = ?')
      .bind(shop.id, input.requestKey)
      .first<Appointment>();
  const replay = (a: Appointment) => {
    if (a.request_fingerprint !== fingerprint)
      throw new ApiError(
        409,
        'Esta solicitação já foi usada. Atualize os dados e tente novamente.',
      );
    if (a.status === 'cancelled')
      throw new ApiError(
        409,
        'A reserva desta solicitação já foi cancelada. Escolha um novo horário.',
      );
    return json({ appointment: receipt(a), replayed: true });
  };
  const previous = await existing();
  if (previous) return replay(previous);
  const service = await getService(env.DB, shop.id, input.serviceId);
  if (!Number.isFinite(new Date(input.startsAt * 1000).getTime()))
    throw new ApiError(400, 'Horário inválido.');
  const date = localDate(new Date(input.startsAt * 1000), shop.timezone);
  validateDate(date, Date.now(), shop.timezone);
  const config = await getSchedule(env.DB, shop);
  if (!scheduleCandidates(config, shop, date, service.duration, origin).includes(input.startsAt))
    throw new ApiError(
      400,
      'O serviço precisa caber no expediente e começar em um horário disponível.',
    );
  const id = crypto.randomUUID();
  try {
    // O trigger SQL ocupa todos os segmentos atomicamente. A consulta prévia
    // de disponibilidade nunca é usada como proteção contra concorrência.
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO customers (shop_id,id,full_name,phone) VALUES (?,?,?,?) ON CONFLICT(shop_id,phone) DO NOTHING',
      ).bind(shop.id, crypto.randomUUID(), input.name, input.phone),
      env.DB.prepare(
        `INSERT INTO appointments
        (id,shop_id,professional_id,customer_id,request_key,request_fingerprint,origin,customer_name,customer_phone,service_id,service_name,price_label,duration_minutes,starts_at,ends_at,schedule_revision,booking_channel)
        VALUES (?,?,?,(SELECT id FROM customers WHERE shop_id = ? AND phone = ?),?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        id,
        shop.id,
        primaryProfessional,
        shop.id,
        input.phone,
        input.requestKey,
        fingerprint,
        origin,
        input.name,
        input.phone,
        service.id,
        service.name,
        service.price,
        service.duration,
        input.startsAt,
        input.startsAt + service.duration * 60,
        config.revision,
        origin,
      ),
    ]);
  } catch (error) {
    const repeated = await existing();
    if (repeated) return replay(repeated);
    if (String(error).includes('SCHEDULE_CHANGED'))
      throw new ApiError(409, 'A disponibilidade mudou. Confira os horários novamente.');
    if (String(error).includes('UNIQUE constraint failed: occupied_segments.'))
      throw new ApiError(409, 'Esse intervalo acabou de ser reservado. Escolha outro horário.');
    throw error;
  }
  return json(
    {
      appointment: {
        id,
        status: 'confirmed',
        version: 1,
        service: service.name,
        price: service.price,
        duration: service.duration,
        startsAt: input.startsAt,
        endsAt: input.startsAt + service.duration * 60,
      },
      replayed: false,
    },
    201,
  );
}
async function api(request: Request, env: Env) {
  const url = new URL(request.url);
  if (request.method !== 'GET' && request.headers.get('Origin') !== url.origin)
    throw new ApiError(403, 'Abra a página do estabelecimento para continuar.');
  const match = url.pathname.match(/^\/api\/shops\/([^/]+)(\/.*)?$/);
  const shop = await getShop(env.DB, match ? match[1] : firstShop);
  // Rotas antigas são aliases exclusivos da TOMAZ; nunca consultam dados globais.
  const path = match ? match[2] || '/' : url.pathname.slice('/api'.length);
  const adminPath = match ? `/api/shops/${shop.slug}/admin` : '/api/admin';
  if (path === '/admin/login' && request.method === 'POST')
    return login(request, env, shop, adminPath);
  if (path.startsWith('/admin/')) await requireAdmin(request, env, shop);
  if (path === '/admin/schedule' && request.method === 'GET')
    return json(await scheduleView(env.DB, shop));
  if (path === '/admin/schedule/preview' && request.method === 'POST')
    return json(await previewSchedule(env.DB, shop, await body(request, 16384)));
  if (path === '/admin/schedule/save' && request.method === 'POST')
    return json(await saveSchedule(env.DB, shop, await body(request, 16384)));
  const mutation = path.match(/^\/admin\/bookings\/([^/]+)\/(reschedule|cancel)$/);
  if (mutation && request.method === 'POST')
    return json(
      await mutateAppointment(
        env.DB,
        shop,
        mutation[1],
        mutation[2] as 'reschedule' | 'cancel',
        await body(request),
      ),
    );
  if (path === '/services' && request.method === 'GET')
    return json({ shop, services: await getServices(env.DB, shop.id) });
  if (path === '/' && request.method === 'GET') return json({ shop });
  if ((path === '/availability' || path === '/admin/availability') && request.method === 'GET') {
    const date = url.searchParams.get('date');
    validateDate(date, Date.now(), shop.timezone);
    const appointmentId =
      path === '/admin/availability' ? url.searchParams.get('appointmentId') : null;
    if (appointmentId) {
      const appointment = await getAppointment(env.DB, shop, appointmentId);
      if (appointment.status !== 'confirmed')
        throw new ApiError(409, 'A reserva já foi cancelada.');
      return json({
        date,
        slots: await available(
          env.DB,
          shop,
          date,
          appointment.duration_minutes,
          'hub',
          appointment.id,
        ),
      });
    }
    const service = await getService(env.DB, shop.id, url.searchParams.get('serviceId') || '');
    return json({
      date,
      slots: await available(
        env.DB,
        shop,
        date,
        service.duration,
        path.startsWith('/admin/') ? 'hub' : 'link',
      ),
    });
  }
  if (path === '/bookings' && request.method === 'POST') return book(request, env, shop, 'link');
  if (path === '/admin/bookings' && request.method === 'POST')
    return book(request, env, shop, 'hub');
  if (path === '/admin/session' && request.method === 'GET')
    return json({ ok: true, shopId: shop.id });
  if (path === '/admin/logout' && request.method === 'POST') {
    const token = sessionToken(request);
    if (token)
      await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash = ? AND shop_id = ?')
        .bind(await hash(token), shop.id)
        .run();
    return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, '', 0, adminPath) });
  }
  if (path === '/admin/bookings' && request.method === 'GET') {
    const date = url.searchParams.get('date');
    if (
      typeof date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) ||
      new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date
    )
      throw new ApiError(400, 'Data inválida.');
    const status = url.searchParams.get('status') || 'confirmed';
    if (!['confirmed', 'cancelled', 'all'].includes(status))
      throw new ApiError(400, 'Filtro de situação inválido.');
    const [open, close] = dayBounds(date, shop.timezone);
    const { results } = await env.DB.prepare(
      `SELECT ${appointmentColumns} FROM appointments WHERE shop_id = ? AND starts_at >= ? AND starts_at < ? AND (?='all' OR status=?) ORDER BY starts_at`,
    )
      .bind(shop.id, open, close, status, status)
      .all();
    return json({ appointments: results });
  }
  const bookingDetail = path.match(/^\/admin\/bookings\/([^/]+)$/);
  if (bookingDetail && request.method === 'GET') {
    return json(await appointmentDetail(env.DB, shop, bookingDetail[1]));
  }
  if (path === '/admin/customers' && request.method === 'GET') {
    const after = url.searchParams.get('after') || '';
    if (after.length > 100) throw new ApiError(400, 'Página de clientes inválida.');
    const { results } = await env.DB.prepare(
      'SELECT id,full_name,phone FROM customers WHERE shop_id = ? AND id > ? ORDER BY id LIMIT 101',
    )
      .bind(shop.id, after)
      .all<{ id: string; full_name: string; phone: string }>();
    const customers = results.slice(0, 100);
    return json({ customers, nextCursor: results.length > 100 ? customers.at(-1)!.id : null });
  }
  const customerDetail = path.match(/^\/admin\/customers\/([^/]+)$/);
  if (customerDetail && request.method === 'GET') {
    const customer = await env.DB.prepare(
      'SELECT id,full_name,phone FROM customers WHERE shop_id = ? AND id = ?',
    )
      .bind(shop.id, customerDetail[1])
      .first();
    if (!customer) throw new ApiError(404, 'Cliente não encontrado.');
    return json({ customer });
  }
  throw new ApiError(404, 'Página não encontrada.');
}
async function page(request: Request, env: Env) {
  const path = new URL(request.url).pathname;
  if (path.startsWith('/s/')) {
    const match = path.match(/^\/s\/([^/]+)(?:\/hub)?\/?$/);
    if (!match) throw new ApiError(404, 'Página não encontrada.');
    await getShop(env.DB, match[1]);
  }
  return env.ASSETS.fetch(request);
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const response = new URL(request.url).pathname.startsWith('/api/')
        ? await api(request, env)
        : await page(request, env);
      const secured = new Response(response.body, response);
      secured.headers.set('X-Frame-Options', 'DENY');
      secured.headers.set('Referrer-Policy', 'same-origin');
      secured.headers.set('X-Content-Type-Options', 'nosniff');
      secured.headers.set(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      );
      return secured;
    } catch (error) {
      if (error instanceof ApiError) return json({ error: error.message }, error.status);
      // Não registrar payloads, nomes ou telefones nos logs.
      console.error('Falha interna na API', error instanceof Error ? error.name : 'UnknownError');
      return json(
        { error: 'Não foi possível concluir agora. Tente novamente com os mesmos dados.' },
        500,
      );
    }
  },
} satisfies ExportedHandler<Env>;
