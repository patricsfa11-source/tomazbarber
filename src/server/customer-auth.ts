import type { Shop } from '../shared';
import { hash } from './crypto';
import { ApiError } from './errors';
import { customerInput } from './customers';

export interface CustomerAuthEnv {
  DB: D1Database;
  CUSTOMER_AUTH_SECRET?: string;
  VERIFICATION_SENDER?: Fetcher;
  APP_STAGE?: string;
  CUSTOMER_VERIFICATION_MODE?: string;
  PILOT_VERIFICATION_PHONES?: string;
}
export const customerSessionSeconds = 30 * 86400;
export function simulationPhones(env: CustomerAuthEnv): string[] {
  try {
    const phones: unknown = JSON.parse(env.PILOT_VERIFICATION_PHONES || '[]');
    return Array.isArray(phones)
      ? phones
          .filter((p): p is string => typeof p === 'string' && /^\+55\d{11}$/.test(p))
          .slice(0, 10)
      : [];
  } catch {
    return [];
  }
}
export function verificationMode(env: CustomerAuthEnv): 'disabled' | 'sms' | 'simulated' {
  if (!env.CUSTOMER_AUTH_SECRET || env.CUSTOMER_AUTH_SECRET.length < 32) return 'disabled';
  if (
    env.APP_STAGE === 'pilot' &&
    env.CUSTOMER_VERIFICATION_MODE === 'simulated' &&
    simulationPhones(env).length
  )
    return 'simulated';
  return env.VERIFICATION_SENDER && env.CUSTOMER_VERIFICATION_MODE !== 'simulated'
    ? 'sms'
    : 'disabled';
}
function secret(env: CustomerAuthEnv) {
  if (!env.CUSTOMER_AUTH_SECRET || env.CUSTOMER_AUTH_SECRET.length < 32)
    throw new ApiError(
      503,
      'A verificação do celular ainda não está disponível. Tente mais tarde.',
    );
  return env.CUSTOMER_AUTH_SECRET;
}
async function digest(env: CustomerAuthEnv, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret(env)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}
function randomCode() {
  const value = new Uint32Array(1);
  do {
    crypto.getRandomValues(value);
  } while (value[0] >= 4294000000);
  return String(value[0] % 1000000).padStart(6, '0');
}
const token = (request: Request) =>
  request.headers.get('Cookie')?.match(/(?:^|;\s*)tb_customer=([a-f0-9]{64})(?:;|$)/)?.[1];
export function customerCookie(request: Request, value: string, maxAge: number, path: string) {
  return `tb_customer=${value}; HttpOnly; SameSite=Strict; Path=${path}; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
export const maskedPhone = (phone: string) =>
  `${phone.slice(0, 3)} (${phone.slice(3, 5)}) •••••-${phone.slice(-4)}`;
export async function requireCustomer(request: Request, env: CustomerAuthEnv, shop: Shop) {
  secret(env);
  const value = token(request);
  const session = value
    ? await env.DB.prepare(
        'SELECT phone FROM customer_sessions WHERE token_hash=? AND shop_id=? AND expires_at>unixepoch()',
      )
        .bind(await hash(value), shop.id)
        .first<{ phone: string }>()
    : null;
  if (!session)
    throw new ApiError(
      401,
      'Verifique seu celular para acessar seus horários neste estabelecimento.',
    );
  return session.phone;
}
async function rate(env: CustomerAuthEnv, shop: Shop, key: string, seconds: number, max: number) {
  const bucket = await digest(
    env,
    `${shop.id}:${key}:${Math.floor(Date.now() / (seconds * 1000))}`,
  );
  return env.DB.prepare(
    'INSERT INTO verification_limits(bucket,attempts,max_attempts,expires_at) VALUES (?,1,?,unixepoch()+?) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1',
  ).bind(bucket, max, seconds);
}
function limitError(error: unknown): never {
  if (/VERIFICATION_COOLDOWN|CHECK constraint failed: attempts/.test(String(error)))
    throw new ApiError(
      429,
      'Muitas solicitações. Aguarde antes de tentar novamente. O reenvio exige pelo menos 60 segundos.',
    );
  throw error;
}
export async function startVerification(
  request: Request,
  env: CustomerAuthEnv,
  shop: Shop,
  data: Record<string, unknown>,
) {
  secret(env);
  const mode = verificationMode(env);
  if (mode === 'disabled')
    throw new ApiError(
      503,
      'O acesso por código SMS ainda não está disponível. Use o link individual da reserva.',
    );
  const { name, phone } = customerInput(data);
  if (mode === 'simulated') {
    if (!simulationPhones(env).includes(phone))
      throw new ApiError(
        400,
        'A simulação aceita somente os números fictícios indicados nesta tela. Para números reais, use o link individual da reserva.',
      );
  }
  const id = crypto.randomUUID(),
    code = randomCode();
  const expiresAt = Math.floor(Date.now() / 1000) + 300;
  const codeHash = await digest(env, `${id}:${shop.id}:${phone}:${code}`);
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  try {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM verification_limits WHERE expires_at<=unixepoch()'),
      env.DB.prepare('DELETE FROM phone_challenges WHERE expires_at<unixepoch()-86400'),
      env.DB.prepare('DELETE FROM customer_sessions WHERE expires_at<=unixepoch()'),
      await rate(env, shop, `send-ip:${ip}`, 3600, 20),
      await rate(env, shop, `send-phone:${phone}`, 3600, 5),
      env.DB.prepare(
        'INSERT INTO phone_challenges(id,shop_id,phone,code_hash,expires_at,customer_name) VALUES (?,?,?,?,?,?)',
      ).bind(id, shop.id, phone, codeHash, expiresAt, name),
      env.DB.prepare(
        'UPDATE phone_challenges SET invalidated_at=unixepoch() WHERE shop_id=? AND phone=? AND id<>? AND consumed_by IS NULL AND invalidated_at IS NULL',
      ).bind(shop.id, phone, id),
    ]);
  } catch (error) {
    limitError(error);
  }
  try {
    // Contrato do remetente: aceitar uma única mensagem por challengeId, sem registrar o código em logs.
    const response =
      mode === 'simulated'
        ? Response.json({ accepted: true })
        : await env.VERIFICATION_SENDER!.fetch(
            new Request('https://verification-sender/send', {
              method: 'POST',
              signal: AbortSignal.timeout(10000),
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                channel: 'sms',
                challengeId: id,
                shopId: shop.id,
                shopName: shop.name,
                phone,
                code,
                expiresAt,
              }),
            }),
          );
    if (!response.ok) throw new Error('SENDER_FAILED');
    await env.DB.prepare(
      "UPDATE phone_challenges SET delivery_state='sent' WHERE id=? AND shop_id=?",
    )
      .bind(id, shop.id)
      .run();
  } catch {
    await env.DB.prepare(
      "UPDATE phone_challenges SET delivery_state='failed' WHERE id=? AND shop_id=?",
    )
      .bind(id, shop.id)
      .run();
    throw new ApiError(
      503,
      'Não foi possível enviar o código. Aguarde 60 segundos e tente novamente.',
    );
  }
  // A mesma resposta é usada com ou sem reservas para esse telefone.
  return {
    challengeId: id,
    maskedPhone: maskedPhone(phone),
    expiresAt,
    resendAfter: 60,
    ...(mode === 'simulated' ? { simulatedCode: code } : {}),
  };
}
export async function finishVerification(
  request: Request,
  env: CustomerAuthEnv,
  shop: Shop,
  data: Record<string, unknown>,
) {
  secret(env);
  if (
    typeof data.challengeId !== 'string' ||
    !/^[a-f0-9-]{36}$/i.test(data.challengeId) ||
    typeof data.code !== 'string' ||
    !/^\d{6}$/.test(data.code)
  )
    throw new ApiError(400, 'Informe os seis dígitos do código recebido.');
  const challenge = await env.DB.prepare(
    'SELECT phone FROM phone_challenges WHERE id=? AND shop_id=?',
  )
    .bind(data.challengeId, shop.id)
    .first<{ phone: string }>();
  const value = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  const sessionHash = await hash(value);
  const candidate = await digest(
    env,
    `${data.challengeId}:${shop.id}:${challenge?.phone || ''}:${data.code}`,
  );
  let result: D1Result[];
  try {
    result = await env.DB.batch([
      await rate(
        env,
        shop,
        `verify-ip:${request.headers.get('CF-Connecting-IP') || 'local'}`,
        900,
        50,
      ),
      env.DB.prepare(
        "UPDATE phone_challenges SET attempts=attempts+1,consumed_by=CASE WHEN code_hash=? THEN ? ELSE NULL END WHERE id=? AND shop_id=? AND expires_at>unixepoch() AND delivery_state='sent' AND invalidated_at IS NULL AND consumed_by IS NULL AND attempts<5 RETURNING consumed_by,phone",
      ).bind(candidate, sessionHash, data.challengeId, shop.id),
      env.DB.prepare(
        'INSERT INTO customer_sessions(token_hash,shop_id,phone,expires_at) SELECT ?,shop_id,phone,unixepoch()+? FROM phone_challenges WHERE id=? AND shop_id=? AND consumed_by=?',
      ).bind(sessionHash, customerSessionSeconds, data.challengeId, shop.id, sessionHash),
      env.DB.prepare(
        'INSERT INTO customers(shop_id,id,full_name,phone) SELECT shop_id,?,customer_name,phone FROM phone_challenges WHERE id=? AND shop_id=? AND consumed_by=? ON CONFLICT(shop_id,phone) DO UPDATE SET full_name=excluded.full_name',
      ).bind(crypto.randomUUID(), data.challengeId, shop.id, sessionHash),
    ]);
  } catch (error) {
    limitError(error);
  }
  const consumed = result![1].results[0] as
    { consumed_by: string | null; phone: string } | undefined;
  if (!consumed || consumed.consumed_by !== sessionHash)
    throw new ApiError(
      400,
      'Código incorreto, expirado ou já utilizado. Confira ou solicite um novo código.',
    );
  const customer = await env.DB.prepare(
    'SELECT full_name FROM customers WHERE shop_id=? AND phone=?',
  )
    .bind(shop.id, consumed.phone)
    .first<{ full_name: string }>();
  return { token: value, maskedPhone: maskedPhone(consumed.phone), name: customer!.full_name };
}
export async function logoutCustomer(request: Request, env: CustomerAuthEnv, shop: Shop) {
  const value = token(request);
  if (value)
    await env.DB.prepare('DELETE FROM customer_sessions WHERE token_hash=? AND shop_id=?')
      .bind(await hash(value), shop.id)
      .run();
}
