import type { Shop } from '../shared';
import { hash } from './crypto';
import { ApiError } from './errors';

const randomToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
/** Recupera o mesmo link somente no fluxo de criação/reenvio idempotente já autenticado pela requestKey. */
export async function privateBookingLink(
  db: D1Database,
  shop: Shop,
  id: string,
  requestKey: string,
): Promise<string | null> {
  await db
    .prepare('INSERT OR IGNORE INTO booking_link_keys(shop_id,secret) VALUES (?,?)')
    .bind(shop.id, randomToken())
    .run();
  const secret = (await db
    .prepare('SELECT secret FROM booking_link_keys WHERE shop_id=?')
    .bind(shop.id)
    .first<{ secret: string }>())!.secret;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(JSON.stringify([shop.id, id, requestKey])),
  );
  const token = Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, '0')).join(
    '',
  );
  await db
    .prepare(
      'INSERT OR IGNORE INTO booking_links(shop_id,appointment_id,token_hash) VALUES (?,?,?)',
    )
    .bind(shop.id, id, await hash(token))
    .run();
  const link = await db
    .prepare('SELECT revoked_at,token_hash FROM booking_links WHERE shop_id=? AND appointment_id=?')
    .bind(shop.id, id)
    .first<{ revoked_at: number | null; token_hash: string }>();
  if (!link || link.revoked_at !== null || link.token_hash !== (await hash(token))) return null;
  return `/s/${shop.slug}/reserva/${id}#acesso=${token}`;
}
const sessionToken = (r: Request) =>
  r.headers.get('Cookie')?.match(/(?:^|;\s*)tb_booking=([a-f0-9]{64})(?:;|$)/)?.[1];
export function bookingLinkCookie(r: Request, value: string, maxAge: number, path: string) {
  return `tb_booking=${value}; HttpOnly; SameSite=Strict; Path=${path}; Max-Age=${maxAge}${new URL(r.url).protocol === 'https:' ? '; Secure' : ''}`;
}
export async function openBookingLink(
  r: Request,
  db: D1Database,
  shop: Shop,
  id: string,
  data: Record<string, unknown>,
) {
  const bucket = await hash(
    `private-link:${shop.id}:${r.headers.get('CF-Connecting-IP') || 'local'}:${Math.floor(Date.now() / 900000)}`,
  );
  const attempt = await db
    .prepare(
      'INSERT INTO login_attempts(bucket,attempts,expires_at) VALUES (?,1,unixepoch()+900) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts',
    )
    .bind(bucket)
    .first<{ attempts: number }>();
  if (!attempt || attempt.attempts > 30)
    throw new ApiError(429, 'Muitas tentativas. Aguarde 15 minutos.');
  const token =
    typeof data.token === 'string' && /^[a-f0-9]{64}$/.test(data.token) ? data.token : '';
  const link = token
    ? await db
        .prepare(
          'SELECT appointment_id FROM booking_links WHERE shop_id=? AND appointment_id=? AND token_hash=? AND revoked_at IS NULL',
        )
        .bind(shop.id, id, await hash(token))
        .first()
    : null;
  if (!link)
    throw new ApiError(
      401,
      'Este link privado não dá acesso à reserva. Abra o link completo salvo na confirmação.',
    );
  const value = randomToken();
  await db.batch([
    db.prepare('DELETE FROM booking_link_sessions WHERE expires_at<=unixepoch()'),
    db
      .prepare(
        'INSERT INTO booking_link_sessions(token_hash,shop_id,appointment_id,expires_at) VALUES (?,?,?,unixepoch()+86400)',
      )
      .bind(await hash(value), shop.id, id),
  ]);
  return value;
}
export async function requireBookingLink(r: Request, db: D1Database, shop: Shop, id: string) {
  const token = sessionToken(r);
  const session = token
    ? await db
        .prepare(
          'SELECT s.appointment_id FROM booking_link_sessions s JOIN booking_links b ON b.shop_id=s.shop_id AND b.appointment_id=s.appointment_id WHERE s.token_hash=? AND s.shop_id=? AND s.appointment_id=? AND s.expires_at>unixepoch() AND b.revoked_at IS NULL',
        )
        .bind(await hash(token), shop.id, id)
        .first()
    : null;
  if (!session)
    throw new ApiError(
      401,
      'Abra o link privado completo para consultar esta reserva. Nome e telefone não dão acesso.',
    );
}
export async function closeBookingLink(r: Request, db: D1Database, shop: Shop, id: string) {
  const token = sessionToken(r);
  if (token)
    await db
      .prepare(
        'DELETE FROM booking_link_sessions WHERE token_hash=? AND shop_id=? AND appointment_id=?',
      )
      .bind(await hash(token), shop.id, id)
      .run();
}
export async function revokeBookingLink(db: D1Database, shop: Shop, id: string) {
  await db.batch([
    db
      .prepare(
        'UPDATE booking_links SET revoked_at=unixepoch() WHERE shop_id=? AND appointment_id=?',
      )
      .bind(shop.id, id),
    db
      .prepare('DELETE FROM booking_link_sessions WHERE shop_id=? AND appointment_id=?')
      .bind(shop.id, id),
  ]);
}
