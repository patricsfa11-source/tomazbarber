import { ApiError } from '../errors';
import { hash } from '../crypto';
import { hmac, type WhatsAppEnv } from './meta';
import { whatsappShop } from './queue';

function equal(a: string, b: string) {
  if (a.length !== b.length) return false;
  let different = 0;
  for (let i = 0; i < a.length; i++) different |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return different === 0;
}
async function bytes(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'Evento vazio.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const r = await reader.read();
    if (r.done) break;
    size += r.value.byteLength;
    if (size > 262144) {
      await reader.cancel();
      throw new ApiError(413, 'Evento muito grande.');
    }
    chunks.push(r.value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}
type Status = {
  id?: string;
  status?: string;
  recipient_id?: string;
  timestamp?: string;
  biz_opaque_callback_data?: string;
  errors?: { code?: number }[];
};
export async function whatsappWebhook(request: Request, env: WhatsAppEnv) {
  const url = new URL(request.url);
  if (request.method === 'GET') {
    if (
      !env.WHATSAPP_VERIFY_TOKEN ||
      env.WHATSAPP_VERIFY_TOKEN.length < 32 ||
      url.searchParams.get('hub.mode') !== 'subscribe' ||
      !equal(url.searchParams.get('hub.verify_token') || '', env.WHATSAPP_VERIFY_TOKEN)
    )
      throw new ApiError(403, 'Verificação inválida.');
    const challenge = url.searchParams.get('hub.challenge') || '';
    if (!/^\d{1,1000}$/.test(challenge)) throw new ApiError(400, 'Desafio inválido.');
    return new Response(challenge, {
      headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
    });
  }
  if (request.method !== 'POST') throw new ApiError(405, 'Método não permitido.');
  if (!env.WHATSAPP_APP_SECRET || env.WHATSAPP_APP_SECRET.length < 32)
    throw new ApiError(503, 'Webhook não configurado.');
  const raw = await bytes(request),
    signature = request.headers.get('X-Hub-Signature-256') || '';
  if (
    !/^sha256=[a-f0-9]{64}$/.test(signature) ||
    !equal(signature, `sha256=${await hmac(env.WHATSAPP_APP_SECRET, raw)}`)
  )
    throw new ApiError(401, 'Assinatura inválida.');
  let event: {
    object?: string;
    entry?: {
      id?: string;
      changes?: {
        field?: string;
        value?: { metadata?: { phone_number_id?: string }; statuses?: Status[] };
      }[];
    }[];
  };
  try {
    event = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new ApiError(400, 'Evento inválido.');
  }
  if (!event || event.object !== 'whatsapp_business_account' || !Array.isArray(event.entry))
    throw new ApiError(400, 'Evento inválido.');
  let count = 0;
  for (const entry of event.entry) {
    if (!entry || entry.id !== env.WHATSAPP_WABA_ID || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (
        !change ||
        !change.value ||
        change.field !== 'messages' ||
        change.value?.metadata?.phone_number_id !== env.WHATSAPP_PHONE_NUMBER_ID ||
        !Array.isArray(change.value.statuses)
      )
        continue;
      for (const status of change.value.statuses) {
        if (++count > 100) throw new ApiError(413, 'Eventos demais numa solicitação.');
        if (
          !status ||
          typeof status.id !== 'string' ||
          !/^wamid\.[A-Za-z0-9+/=_-]{1,400}$/.test(status.id) ||
          !['sent', 'delivered', 'read', 'failed'].includes(status.status || '')
        )
          continue;
        const opaque =
          typeof status.biz_opaque_callback_data === 'string'
            ? status.biz_opaque_callback_data.match(/^wa:([a-f0-9-]{36}):([a-f0-9-]{36})$/i)
            : null;
        const delivery = await env.DB.prepare(
          `SELECT d.id,d.recipient,d.claim_token,d.provider_id,t.token FROM whatsapp_deliveries d JOIN whatsapp_attempts t ON t.delivery_id=d.id WHERE d.shop_id=? AND ${opaque ? 'd.id=? AND t.token=?' : 't.provider_id=?'} LIMIT 1`,
        )
          .bind(whatsappShop, ...(opaque ? [opaque[1], opaque[2]] : [status.id]))
          .first<{
            id: string;
            recipient: string;
            claim_token: string;
            provider_id: string | null;
            token: string;
          }>();
        if (
          !delivery ||
          status.recipient_id !== delivery.recipient.slice(1) ||
          delivery.claim_token !== delivery.token ||
          (delivery.provider_id && delivery.provider_id !== status.id)
        )
          continue;
        const key = await hash(
          `${delivery.id}:${status.id}:${status.status}:${status.timestamp || ''}`,
        );
        const allowed =
          status.status === 'read'
            ? ['sending', 'unknown', 'accepted', 'sent', 'delivered', 'failed']
            : status.status === 'delivered'
              ? ['sending', 'unknown', 'accepted', 'sent', 'failed']
              : ['sending', 'unknown', 'accepted', ...(status.status === 'failed' ? ['sent'] : [])];
        const attemptAllowed = allowed.map((s) => (s === 'sending' ? 'started' : s));
        const error =
          status.status === 'failed' && Number.isSafeInteger(status.errors?.[0]?.code)
            ? String(status.errors![0].code)
            : null;
        await env.DB.batch([
          env.DB.prepare(
            'INSERT OR IGNORE INTO whatsapp_webhook_events(event_key,delivery_id,status) VALUES (?,?,?)',
          ).bind(key, delivery.id, status.status),
          env.DB.prepare(
            `UPDATE whatsapp_attempts SET state=?,provider_id=?,error_code=? WHERE token=? AND (provider_id IS NULL OR provider_id=?) AND state IN (${attemptAllowed.map(() => '?').join(',')})`,
          ).bind(status.status, status.id, error, delivery.token, status.id, ...attemptAllowed),
          env.DB.prepare(
            `UPDATE whatsapp_deliveries SET state=?,provider_id=?,last_error_code=?,lease_expires_at=NULL,payload=NULL,iv=NULL,updated_at=unixepoch() WHERE id=? AND shop_id=? AND claim_token=? AND (provider_id IS NULL OR provider_id=?) AND state IN (${allowed.map(() => '?').join(',')})`,
          ).bind(
            status.status,
            status.id,
            error,
            delivery.id,
            whatsappShop,
            delivery.token,
            status.id,
            ...allowed,
          ),
        ]);
      }
    }
  }
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
