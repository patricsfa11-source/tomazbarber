import type { Shop } from '../../shared';
import type { AppointmentRecord } from '../../calendar';
import { ApiError } from '../errors';
import { getShop } from '../shops';
import {
  configuration,
  decrypt,
  encrypt,
  sendMeta,
  template,
  templateName,
  type MessageKind,
  type TemplatePayload,
  type WhatsAppEnv,
} from './meta';

export const whatsappShop = 'tomaz-barber';
export interface Delivery {
  id: string;
  shop_id: string;
  dedupe_key: string;
  kind: MessageKind;
  appointment_id: string | null;
  booking_version: number | null;
  challenge_id: string | null;
  recipient: string;
  payload: string | null;
  iv: string | null;
  state: string;
  attempts: number;
  expires_at: number;
  next_attempt_at: number;
  claim_token: string | null;
  provider_id: string | null;
  last_error_code: string | null;
}
interface Enqueue {
  key: string;
  kind: MessageKind;
  recipient: string;
  message: TemplatePayload;
  expiresAt: number;
  appointmentId?: string;
  version?: number;
  challengeId?: string;
  nextAttempt?: number;
}
async function insertion(env: WhatsAppEnv, item: Enqueue) {
  const id = crypto.randomUUID(),
    encrypted = await encrypt(env, item.message, id);
  return env.DB.prepare(
    `INSERT OR IGNORE INTO whatsapp_deliveries(id,shop_id,dedupe_key,kind,appointment_id,booking_version,challenge_id,recipient,payload,iv,expires_at,next_attempt_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    id,
    whatsappShop,
    item.key,
    item.kind,
    item.appointmentId ?? null,
    item.version ?? null,
    item.challengeId ?? null,
    item.recipient,
    encrypted.payload,
    encrypted.iv,
    item.expiresAt,
    item.nextAttempt ?? Math.floor(Date.now() / 1000),
  );
}
export async function enqueue(env: WhatsAppEnv, item: Enqueue) {
  await (await insertion(env, item)).run();
  return (await env.DB.prepare('SELECT * FROM whatsapp_deliveries WHERE shop_id=? AND dedupe_key=?')
    .bind(whatsappShop, item.key)
    .first<Delivery>())!;
}
function parameters(a: AppointmentRecord, shop: Shop, url: string, reminder = false) {
  const first = a.customer_name.trim().split(/\s+/)[0].slice(0, 80);
  const date = new Intl.DateTimeFormat('pt-BR', {
    timeZone: shop.timezone,
    dateStyle: 'full',
  }).format(new Date(a.starts_at * 1000));
  const time = new Intl.DateTimeFormat('pt-BR', {
    timeZone: shop.timezone,
    timeStyle: 'short',
  }).format(new Date(a.starts_at * 1000));
  return reminder ? [first, a.service_name, time, url] : [first, date, time, a.service_name, url];
}
export async function stageEvents(env: WhatsAppEnv) {
  const cfg = configuration(env),
    shop = await getShop(env.DB, whatsappShop);
  const { results } = await env.DB.prepare(
    `SELECT a.*,o.id AS outbox_id,o.booking_version AS event_version,o.kind AS event_kind,o.created_at AS event_created_at FROM notification_outbox o JOIN appointments a ON a.shop_id=o.shop_id AND a.id=o.appointment_id WHERE o.shop_id=? AND NOT EXISTS (SELECT 1 FROM whatsapp_processed_events p WHERE p.outbox_id=o.id) ORDER BY o.id LIMIT 50`,
  )
    .bind(whatsappShop)
    .all<
      AppointmentRecord & {
        outbox_id: number;
        event_version: number;
        event_kind: string;
        event_created_at: number;
      }
    >();
  for (const a of results) {
    let outcome = 'queued';
    if (a.event_created_at < cfg.since) outcome = 'before_activation';
    else if (
      a.version !== a.event_version ||
      (a.event_kind === 'booking.cancelled' ? a.status !== 'cancelled' : a.status !== 'confirmed')
    )
      outcome = 'obsolete';
    else if (a.customer_phone !== cfg.recipient) outcome = 'outside_test';
    const statements: D1PreparedStatement[] = [];
    if (outcome === 'queued') {
      const kind: MessageKind =
        a.event_kind === 'booking.created'
          ? 'confirmation'
          : a.event_kind === 'booking.rescheduled'
            ? 'reschedule'
            : 'cancellation';
      statements.push(
        await insertion(env, {
          key: `booking:${a.id}:${a.version}:${kind}`,
          kind,
          recipient: a.customer_phone,
          message: template(
            env,
            kind,
            a.customer_phone,
            parameters(a, shop, `${cfg.publicUrl}/s/${shop.slug}/meus-horarios`),
          ),
          appointmentId: a.id,
          version: a.version,
          expiresAt:
            kind === 'cancellation'
              ? a.event_created_at + 86400
              : Math.max(a.starts_at, a.event_created_at + 600),
        }),
      );
    }
    statements.push(
      env.DB.prepare(
        'INSERT OR IGNORE INTO whatsapp_processed_events(outbox_id,outcome) VALUES (?,?)',
      ).bind(a.outbox_id, outcome),
    );
    await env.DB.batch(statements);
  }
}
export async function stageReminders(env: WhatsAppEnv, now = Math.floor(Date.now() / 1000)) {
  const cfg = configuration(env),
    shop = await getShop(env.DB, whatsappShop);
  const { results } = await env.DB.prepare(
    `SELECT a.*,r.due_at FROM appointment_reminders r JOIN appointments a ON a.shop_id=r.shop_id AND a.id=r.appointment_id WHERE r.shop_id=? AND r.state='scheduled' AND r.booking_version=a.version AND a.status='confirmed' AND r.due_at<=? AND r.due_at+120>? AND a.starts_at>? AND a.customer_phone=? AND EXISTS (SELECT 1 FROM notification_outbox o WHERE o.shop_id=a.shop_id AND o.appointment_id=a.id AND o.booking_version=a.version AND o.created_at>=?) ORDER BY r.due_at LIMIT 50`,
  )
    .bind(whatsappShop, now, now, now, cfg.recipient, cfg.since)
    .all<AppointmentRecord & { due_at: number }>();
  for (const a of results)
    await enqueue(env, {
      key: `booking:${a.id}:${a.version}:reminder`,
      kind: 'reminder',
      recipient: a.customer_phone,
      message: template(
        env,
        'reminder',
        a.customer_phone,
        parameters(a, shop, `${cfg.publicUrl}/s/${shop.slug}/meus-horarios`, true),
      ),
      appointmentId: a.id,
      version: a.version,
      nextAttempt: a.due_at,
      expiresAt: Math.min(a.starts_at, a.due_at + 120),
    });
}
async function valid(env: WhatsAppEnv, d: Delivery) {
  const cfg = configuration(env);
  if (d.shop_id !== whatsappShop || d.recipient !== cfg.recipient) return false;
  if (d.appointment_id) {
    const a = await env.DB.prepare(
      'SELECT version,status FROM appointments WHERE shop_id=? AND id=?',
    )
      .bind(d.shop_id, d.appointment_id)
      .first<{ version: number; status: string }>();
    if (
      !a ||
      a.version !== d.booking_version ||
      a.status !== (d.kind === 'cancellation' ? 'cancelled' : 'confirmed')
    )
      return false;
  }
  if (d.challenge_id)
    return !!(await env.DB.prepare(
      "SELECT id FROM phone_challenges WHERE id=? AND shop_id=? AND phone=? AND consumed_by IS NULL AND invalidated_at IS NULL AND expires_at>unixepoch() AND delivery_state IN ('pending','sent')",
    )
      .bind(d.challenge_id, d.shop_id, d.recipient)
      .first());
  return true;
}
export async function dispatch(env: WhatsAppEnv, id: string, now = Math.floor(Date.now() / 1000)) {
  configuration(env);
  const prior = await env.DB.prepare('SELECT * FROM whatsapp_deliveries WHERE id=? AND shop_id=?')
    .bind(id, whatsappShop)
    .first<Delivery>();
  if (!prior || !['queued', 'retry'].includes(prior.state)) return;
  const currentTemplate = templateName(env, prior.kind);
  if (!(await valid(env, prior))) {
    await env.DB.prepare(
      "UPDATE whatsapp_deliveries SET state='suppressed',payload=NULL,iv=NULL,updated_at=unixepoch() WHERE id=? AND state IN ('queued','retry')",
    )
      .bind(id)
      .run();
    return;
  }
  const token = crypto.randomUUID();
  // O mesmo UPDATE que adquire o lease valida versão, situação, prazo e código.
  // O trigger de appointments serializa alterações enquanto a requisição está em voo.
  const claim = await env.DB.batch([
    env.DB.prepare(
      `UPDATE whatsapp_deliveries SET state='sending',attempts=attempts+1,claim_token=?,lease_expires_at=unixepoch()+45,updated_at=unixepoch() WHERE id=? AND shop_id=? AND state IN ('queued','retry') AND attempts<5 AND provider_id IS NULL AND next_attempt_at<=? AND expires_at>? AND (appointment_id IS NULL OR EXISTS (SELECT 1 FROM appointments a WHERE a.shop_id=whatsapp_deliveries.shop_id AND a.id=appointment_id AND a.version=booking_version AND a.status=CASE WHEN kind='cancellation' THEN 'cancelled' ELSE 'confirmed' END)) AND (challenge_id IS NULL OR EXISTS (SELECT 1 FROM phone_challenges c WHERE c.id=challenge_id AND c.shop_id=whatsapp_deliveries.shop_id AND c.phone=recipient AND c.consumed_by IS NULL AND c.invalidated_at IS NULL AND c.expires_at>unixepoch() AND c.delivery_state IN ('pending','sent'))) AND (kind<>'reminder' OR EXISTS (SELECT 1 FROM whatsapp_deliveries confirmed WHERE confirmed.shop_id=whatsapp_deliveries.shop_id AND confirmed.appointment_id=whatsapp_deliveries.appointment_id AND confirmed.booking_version=whatsapp_deliveries.booking_version AND confirmed.kind IN ('confirmation','reschedule') AND confirmed.state IN ('accepted','sent','delivered','read'))) RETURNING *`,
    ).bind(token, id, whatsappShop, now, now),
    env.DB.prepare(
      "INSERT INTO whatsapp_attempts(token,delivery_id,attempt,state) SELECT claim_token,id,attempts,'started' FROM whatsapp_deliveries WHERE id=? AND claim_token=? AND state='sending'",
    ).bind(id, token),
  ]);
  const d = claim[0].results[0] as unknown as Delivery | undefined;
  if (!d) return;
  let result: Awaited<ReturnType<typeof sendMeta>>;
  try {
    const payload = await decrypt(env, d.payload!, d.iv!, d.id);
    payload.template.name = currentTemplate;
    payload.biz_opaque_callback_data = `wa:${id}:${token}`;
    result = await sendMeta(env, payload);
  } catch {
    result = { type: 'rejected', code: 'PAYLOAD_UNREADABLE' };
  }
  if (result.type === 'accepted') {
    try {
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE whatsapp_attempts SET state='accepted',provider_id=? WHERE token=? AND state='started'",
        ).bind(result.id, token),
        env.DB.prepare(
          "UPDATE whatsapp_deliveries SET state='accepted',provider_id=?,last_error_code=NULL,payload=NULL,iv=NULL,lease_expires_at=NULL,updated_at=unixepoch() WHERE id=? AND claim_token=? AND state='sending'",
        ).bind(result.id, id, token),
      ]);
    } catch {
      /* Um resultado não persistido nunca provoca outro POST automático. O lease vira unknown. */
    }
  } else {
    const state =
      result.type === 'unknown'
        ? 'unknown'
        : result.type === 'retry' && d.attempts < 5
          ? 'retry'
          : 'failed';
    const delay = Math.max(result.retryAfter ?? 60, Math.min(3600, 60 * 2 ** (d.attempts - 1)));
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE whatsapp_attempts SET state=?,error_code=? WHERE token=? AND state='started'",
      ).bind(result.type === 'unknown' ? 'unknown' : 'rejected', result.code, token),
      env.DB.prepare(
        "UPDATE whatsapp_deliveries SET state=?,last_error_code=?,next_attempt_at=unixepoch()+?,lease_expires_at=NULL,payload=CASE WHEN ?='unknown' THEN NULL ELSE payload END,iv=CASE WHEN ?='unknown' THEN NULL ELSE iv END,updated_at=unixepoch() WHERE id=? AND claim_token=? AND state='sending'",
      ).bind(state, result.code, delay, state, state, id, token),
    ]);
  }
}
export async function processWhatsApp(env: WhatsAppEnv, max = 20) {
  if (env.WHATSAPP_MODE !== 'test') return;
  configuration(env);
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE whatsapp_attempts SET state='unknown',error_code='WORKER_INTERRUPTED' WHERE state='started' AND token IN (SELECT claim_token FROM whatsapp_deliveries WHERE state='sending' AND lease_expires_at<=unixepoch())",
    ),
    env.DB.prepare(
      "UPDATE whatsapp_deliveries SET state='unknown',payload=NULL,iv=NULL,last_error_code='WORKER_INTERRUPTED',updated_at=unixepoch() WHERE state='sending' AND lease_expires_at<=unixepoch()",
    ),
    env.DB.prepare(
      "UPDATE whatsapp_deliveries SET state='expired',updated_at=unixepoch() WHERE state IN ('queued','retry') AND expires_at<=unixepoch()",
    ),
    env.DB.prepare(
      'UPDATE whatsapp_deliveries SET payload=NULL,iv=NULL WHERE expires_at<=unixepoch() AND payload IS NOT NULL',
    ),
  ]);
  await stageEvents(env);
  await stageReminders(env);
  const { results } = await env.DB.prepare(
    "SELECT id FROM whatsapp_deliveries WHERE shop_id=? AND state IN ('queued','retry') AND next_attempt_at<=unixepoch() AND expires_at>unixepoch() ORDER BY CASE kind WHEN 'reminder' THEN 1 ELSE 0 END,created_at,id LIMIT ?",
  )
    .bind(whatsappShop, Math.min(50, Math.max(1, max)))
    .all<{ id: string }>();
  for (const row of results) await dispatch(env, row.id);
}
export async function sendAccessCode(
  env: WhatsAppEnv,
  shop: Shop,
  data: { challengeId: string; phone: string; code: string; expiresAt: number },
) {
  const cfg = configuration(env);
  if (shop.id !== whatsappShop || data.phone !== cfg.recipient)
    throw new ApiError(
      503,
      'Nesta etapa, o WhatsApp está restrito ao número autorizado para teste na TOMAZ BARBER.',
    );
  const d = await enqueue(env, {
    key: `access:${data.challengeId}`,
    kind: 'access_code',
    recipient: data.phone,
    message: template(env, 'access_code', data.phone, [data.code]),
    challengeId: data.challengeId,
    expiresAt: data.expiresAt,
  });
  await dispatch(env, d.id);
}
export async function testMessage(env: WhatsAppEnv, shop: Shop, data: Record<string, unknown>) {
  if (shop.id !== whatsappShop)
    throw new ApiError(404, 'WhatsApp não configurado neste estabelecimento.');
  if (typeof data.requestKey !== 'string' || !/^[a-f0-9-]{36}$/i.test(data.requestKey))
    throw new ApiError(400, 'Atualize a página antes de enviar o teste.');
  const cfg = configuration(env);
  const d = await enqueue(env, {
    key: `probe:${data.requestKey}`,
    kind: 'test',
    recipient: cfg.recipient,
    message: template(env, 'test', cfg.recipient),
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  });
  await dispatch(env, d.id);
  return { id: d.id };
}
export async function retryDelivery(
  env: WhatsAppEnv,
  shop: Shop,
  id: string,
  data: Record<string, unknown>,
) {
  configuration(env);
  if (shop.id !== whatsappShop) throw new ApiError(404, 'Envio não encontrado.');
  if (typeof data.requestKey !== 'string' || !/^[a-f0-9-]{36}$/i.test(data.requestKey))
    throw new ApiError(400, 'Atualize a página antes de tentar novamente.');
  const replay = await env.DB.prepare(
    'SELECT delivery_id FROM whatsapp_retry_requests WHERE shop_id=? AND request_key=?',
  )
    .bind(shop.id, data.requestKey)
    .first<{ delivery_id: string }>();
  if (replay) {
    if (replay.delivery_id !== id) throw new ApiError(409, 'Solicitação já utilizada.');
    return { ok: true };
  }
  const d = await env.DB.prepare('SELECT * FROM whatsapp_deliveries WHERE id=? AND shop_id=?')
    .bind(id, shop.id)
    .first<Delivery>();
  if (!d) throw new ApiError(404, 'Envio não encontrado.');
  if (
    d.state !== 'failed' ||
    d.provider_id ||
    !/^\d+$/.test(d.last_error_code || '') ||
    d.attempts >= 5 ||
    d.expires_at <= Math.floor(Date.now() / 1000) ||
    !d.payload ||
    !(await valid(env, d))
  ) {
    const repeated = await env.DB.prepare(
      'SELECT delivery_id FROM whatsapp_retry_requests WHERE shop_id=? AND request_key=?',
    )
      .bind(shop.id, data.requestKey)
      .first<{ delivery_id: string }>();
    if (repeated?.delivery_id === id) return { ok: true };
    throw new ApiError(
      409,
      'Este envio não pode ser repetido com segurança. Confira o estado atual.',
    );
  }
  try {
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO whatsapp_retry_requests(shop_id,request_key,delivery_id) VALUES (?,?,?)',
      ).bind(shop.id, data.requestKey, id),
      env.DB.prepare(
        "UPDATE whatsapp_deliveries SET state='retry',next_attempt_at=unixepoch(),updated_at=unixepoch() WHERE id=? AND shop_id=? AND state='failed' AND provider_id IS NULL AND attempts=? AND expires_at>unixepoch()",
      ).bind(id, shop.id, d.attempts),
    ]);
  } catch (error) {
    const repeated = await env.DB.prepare(
      'SELECT delivery_id FROM whatsapp_retry_requests WHERE shop_id=? AND request_key=?',
    )
      .bind(shop.id, data.requestKey)
      .first<{ delivery_id: string }>();
    if (!repeated || repeated.delivery_id !== id) throw error;
  }
  return { ok: true };
}
