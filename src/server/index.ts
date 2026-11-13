import { services, localDate } from '../shared';
import { ApiError, available, candidates, dayBounds, validateDate } from './schedule';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_PASSWORD?: string;
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
}
const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
  });
async function hash(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
function receipt(a: Appointment) {
  return {
    id: a.id,
    service: a.service_name,
    price: a.price_label,
    duration: a.duration_minutes,
    startsAt: a.starts_at,
    endsAt: a.ends_at,
  };
}
async function body(request: Request): Promise<Record<string, unknown>> {
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
    if (size > 4096) {
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
async function requireAdmin(request: Request, env: Env) {
  const token = request.headers
    .get('Cookie')
    ?.match(/(?:^|;\s*)tb_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (!token || !env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 20)
    throw new ApiError(401, 'Entre no hub para continuar.');
  const session = await env.DB.prepare(
    'SELECT expires_at FROM admin_sessions WHERE token_hash = ? AND expires_at > unixepoch()',
  )
    .bind(await hash(token))
    .first();
  if (!session) throw new ApiError(401, 'Sua sessão terminou. Entre novamente.');
}
function cookie(request: Request, token: string, maxAge: number) {
  return `tb_session=${token}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
async function login(request: Request, env: Env) {
  if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 20)
    throw new ApiError(503, 'Configure o acesso administrativo no ambiente local.');
  const data = await body(request);
  const bucket = await hash(
    `${request.headers.get('CF-Connecting-IP') || 'local'}:${Math.floor(Date.now() / 900000)}`,
  );
  const attempt = await env.DB.prepare(
    'INSERT INTO login_attempts (bucket, attempts, expires_at) VALUES (?,1,unixepoch()+900) ON CONFLICT(bucket) DO UPDATE SET attempts = attempts + 1 RETURNING attempts',
  )
    .bind(bucket)
    .first<{ attempts: number }>();
  if (!attempt || attempt.attempts > 10)
    throw new ApiError(429, 'Muitas tentativas. Aguarde 15 minutos.');
  if (
    typeof data.password !== 'string' ||
    data.password.length > 200 ||
    (await hash(data.password)) !== (await hash(env.ADMIN_PASSWORD))
  )
    throw new ApiError(401, 'Senha incorreta.');
  const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at <= unixepoch()'),
    env.DB.prepare('DELETE FROM login_attempts WHERE expires_at <= unixepoch()'),
    env.DB.prepare(
      'INSERT INTO admin_sessions (token_hash, expires_at) VALUES (?,unixepoch()+28800)',
    ).bind(await hash(token)),
  ]);
  return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, token, 28800) });
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
async function book(request: Request, env: Env, origin: 'link' | 'hub') {
  const input = parseBooking(await body(request));
  const fingerprint = await hash(JSON.stringify({ ...input, origin }));
  const existing = () =>
    env.DB.prepare('SELECT * FROM appointments WHERE request_key = ?')
      .bind(input.requestKey)
      .first<Appointment>();
  const replay = (a: Appointment) => {
    if (a.request_fingerprint !== fingerprint)
      throw new ApiError(
        409,
        'Esta solicitação já foi usada. Atualize os dados e tente novamente.',
      );
    return json({ appointment: receipt(a), replayed: true });
  };
  const previous = await existing();
  if (previous) return replay(previous);
  const service = services.find((s) => s.id === input.serviceId);
  if (!service) throw new ApiError(400, 'Serviço inválido.');
  if (!Number.isFinite(new Date(input.startsAt * 1000).getTime()))
    throw new ApiError(400, 'Horário inválido.');
  const date = localDate(new Date(input.startsAt * 1000));
  validateDate(date);
  if (!candidates(date, service.duration).includes(input.startsAt))
    throw new ApiError(
      400,
      'O serviço precisa caber no expediente e começar em um horário disponível.',
    );
  const id = crypto.randomUUID();
  try {
    // O trigger SQL ocupa todos os segmentos atomicamente. A consulta prévia
    // de disponibilidade nunca é usada como proteção contra concorrência.
    await env.DB.prepare(
      `INSERT INTO appointments
      (id,request_key,request_fingerprint,origin,customer_name,customer_phone,service_id,service_name,price_label,duration_minutes,starts_at,ends_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
      .bind(
        id,
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
      )
      .run();
  } catch (error) {
    const repeated = await existing();
    if (repeated) return replay(repeated);
    if (String(error).includes('UNIQUE constraint failed: occupied_segments.starts_at'))
      throw new ApiError(409, 'Esse intervalo acabou de ser reservado. Escolha outro horário.');
    throw error;
  }
  return json(
    {
      appointment: {
        id,
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
  const path = url.pathname;
  if (request.method !== 'GET' && request.headers.get('Origin') !== url.origin)
    throw new ApiError(403, 'Abra a página da TOMAZ BARBER para continuar.');
  if (path === '/api/services' && request.method === 'GET') return json({ services });
  if (path === '/api/admin/login' && request.method === 'POST') return login(request, env);
  if (path.startsWith('/api/admin/')) await requireAdmin(request, env);
  if (
    (path === '/api/availability' || path === '/api/admin/availability') &&
    request.method === 'GET'
  ) {
    const date = url.searchParams.get('date');
    validateDate(date);
    const service = services.find((s) => s.id === url.searchParams.get('serviceId'));
    if (!service) throw new ApiError(400, 'Escolha um serviço.');
    return json({ date, slots: await available(env.DB, date, service.duration) });
  }
  if (path === '/api/bookings' && request.method === 'POST') return book(request, env, 'link');
  if (path === '/api/admin/bookings' && request.method === 'POST') return book(request, env, 'hub');
  if (path === '/api/admin/session' && request.method === 'GET') return json({ ok: true });
  if (path === '/api/admin/logout' && request.method === 'POST') {
    const token = request.headers
      .get('Cookie')
      ?.match(/(?:^|;\s*)tb_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    if (token)
      await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash = ?')
        .bind(await hash(token))
        .run();
    return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, '', 0) });
  }
  if (path === '/api/admin/bookings' && request.method === 'GET') {
    const date = url.searchParams.get('date');
    validateDate(date);
    const [open, close] = dayBounds(date);
    const { results } = await env.DB.prepare(
      'SELECT id, customer_name, customer_phone, service_name, price_label, duration_minutes, starts_at, ends_at, origin FROM appointments WHERE starts_at >= ? AND starts_at < ? ORDER BY starts_at',
    )
      .bind(open, close)
      .all();
    return json({ appointments: results });
  }
  throw new ApiError(404, 'Página não encontrada.');
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const response = new URL(request.url).pathname.startsWith('/api/')
        ? await api(request, env)
        : await env.ASSETS.fetch(request);
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
