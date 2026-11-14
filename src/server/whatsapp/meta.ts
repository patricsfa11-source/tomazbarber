import { ApiError } from '../errors';

export interface WhatsAppEnv {
  DB: D1Database;
  WHATSAPP_MODE?: string;
  WHATSAPP_TEST_RECIPIENT?: string;
  WHATSAPP_ENABLED_SINCE?: string;
  WHATSAPP_PUBLIC_BASE_URL?: string;
  WHATSAPP_GRAPH_VERSION?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_WABA_ID?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_APP_SECRET?: string;
  WHATSAPP_VERIFY_TOKEN?: string;
  WHATSAPP_PAYLOAD_SECRET?: string;
  WHATSAPP_TEMPLATE_ACCESS_CODE?: string;
  WHATSAPP_TEMPLATE_CONFIRMATION?: string;
  WHATSAPP_TEMPLATE_RESCHEDULE?: string;
  WHATSAPP_TEMPLATE_CANCELLATION?: string;
  WHATSAPP_TEMPLATE_REMINDER?: string;
  /** Transporte substituído só na configuração isolada de testes. */
  WHATSAPP_HTTP?: Fetcher;
}
export type MessageKind =
  'access_code' | 'confirmation' | 'reschedule' | 'cancellation' | 'reminder' | 'test';
export interface TemplatePayload {
  messaging_product: 'whatsapp';
  to: string;
  type: 'template';
  template: { name: string; language: { code: string }; components?: unknown[] };
  biz_opaque_callback_data?: string;
}
export function configuration(env: WhatsAppEnv) {
  // Envios para clientes não são habilitados nesta entrega, mesmo com credenciais.
  if (env.WHATSAPP_MODE !== 'test')
    throw new ApiError(503, 'Os envios de WhatsApp estão desativados para revisão.');
  const since = Math.floor(Date.parse(env.WHATSAPP_ENABLED_SINCE || '') / 1000);
  let publicUrl: URL;
  try {
    publicUrl = new URL(env.WHATSAPP_PUBLIC_BASE_URL || '');
  } catch {
    throw new ApiError(503, 'Configure o endereço público do agendamento.');
  }
  if (
    !/^\+55[1-9]{2}(?:9\d{8}|[2-5]\d{7})$/.test(env.WHATSAPP_TEST_RECIPIENT || '') ||
    !/^v\d+\.\d+$/.test(env.WHATSAPP_GRAPH_VERSION || '') ||
    !/^\d{3,30}$/.test(env.WHATSAPP_PHONE_NUMBER_ID || '') ||
    !/^\d{3,30}$/.test(env.WHATSAPP_WABA_ID || '') ||
    !env.WHATSAPP_ACCESS_TOKEN ||
    !env.WHATSAPP_PAYLOAD_SECRET ||
    env.WHATSAPP_PAYLOAD_SECRET.length < 32 ||
    !Number.isFinite(since) ||
    publicUrl.protocol !== 'https:' ||
    publicUrl.username ||
    publicUrl.password ||
    publicUrl.search ||
    publicUrl.hash
  )
    throw new ApiError(503, 'A configuração do teste de WhatsApp está incompleta.');
  return {
    recipient: env.WHATSAPP_TEST_RECIPIENT!,
    since,
    publicUrl: publicUrl.origin + publicUrl.pathname.replace(/\/$/, ''),
    phoneId: env.WHATSAPP_PHONE_NUMBER_ID!,
    version: env.WHATSAPP_GRAPH_VERSION!,
  };
}
const names: Record<MessageKind, string> = {
  access_code: 'tomaz_acesso_v1',
  confirmation: 'tomaz_reserva_confirmada_v1',
  reschedule: 'tomaz_reserva_remarcada_v1',
  cancellation: 'tomaz_reserva_cancelada_v1',
  reminder: 'tomaz_lembrete_10min_v1',
  test: 'hello_world',
};
export function templateName(env: WhatsAppEnv, kind: MessageKind) {
  const override = env[`WHATSAPP_TEMPLATE_${kind.toUpperCase()}` as keyof WhatsAppEnv];
  const name = typeof override === 'string' && override ? override : names[kind];
  if (!/^[a-z0-9_]{1,512}$/.test(name))
    throw new ApiError(503, 'Nome de modelo do WhatsApp inválido.');
  return name;
}
export function template(
  env: WhatsAppEnv,
  kind: MessageKind,
  recipient: string,
  values: string[] = [],
): TemplatePayload {
  const name = templateName(env, kind);
  const components: unknown[] = values.length
    ? [{ type: 'body', parameters: values.map((text) => ({ type: 'text', text })) }]
    : [];
  if (kind === 'access_code')
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: values[0] }],
    });
  return {
    messaging_product: 'whatsapp',
    to: recipient.slice(1),
    type: 'template',
    template: {
      name,
      language: { code: kind === 'test' ? 'en_US' : 'pt_BR' },
      ...(components.length ? { components } : {}),
    },
  };
}
const hex = (bytes: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (value: string) =>
  Uint8Array.from(value.match(/.{2}/g) || [], (b) => parseInt(b, 16));
export async function hmac(secret: string, bytes: Uint8Array) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return hex(await crypto.subtle.sign('HMAC', key, new Uint8Array(bytes)));
}
async function encryptionKey(env: WhatsAppEnv) {
  if (!env.WHATSAPP_PAYLOAD_SECRET || env.WHATSAPP_PAYLOAD_SECRET.length < 32)
    throw new ApiError(503, 'Configure o segredo da fila de WhatsApp.');
  return crypto.subtle.importKey(
    'raw',
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.WHATSAPP_PAYLOAD_SECRET)),
    'AES-GCM',
    false,
    ['encrypt', 'decrypt'],
  );
}
export async function encrypt(env: WhatsAppEnv, payload: TemplatePayload, id: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(id) },
    await encryptionKey(env),
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return { payload: hex(encrypted), iv: hex(iv) };
}
export async function decrypt(
  env: WhatsAppEnv,
  payload: string,
  iv: string,
  id: string,
): Promise<TemplatePayload> {
  const bytes = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unhex(iv), additionalData: new TextEncoder().encode(id) },
    await encryptionKey(env),
    unhex(payload),
  );
  return JSON.parse(new TextDecoder().decode(bytes));
}
export type SendResult =
  | { type: 'accepted'; id: string }
  | { type: 'retry' | 'rejected' | 'unknown'; code: string; retryAfter?: number };
export async function sendMeta(env: WhatsAppEnv, payload: TemplatePayload): Promise<SendResult> {
  const config = configuration(env);
  // Confere novamente no limite de rede; nunca redireciona uma mensagem de cliente para o número de teste.
  if (payload.to !== config.recipient.slice(1)) return { type: 'rejected', code: 'OUTSIDE_TEST' };
  try {
    const req = new Request(
      `https://graph.facebook.com/${config.version}/${config.phoneId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000),
        redirect: 'manual',
      },
    );
    const response = env.WHATSAPP_HTTP ? await env.WHATSAPP_HTTP.fetch(req) : await fetch(req);
    const data = (await response.json()) as {
      messages?: { id?: string }[];
      error?: { code?: number };
    };
    const id = data.messages?.[0]?.id;
    if (response.ok && typeof id === 'string' && /^wamid\.[A-Za-z0-9+/=_-]{1,400}$/.test(id))
      return { type: 'accepted', id };
    const code = Number.isSafeInteger(data.error?.code)
      ? String(data.error!.code)
      : `HTTP_${response.status}`;
    if (response.status === 429 && data.error && !id)
      return {
        type: 'retry',
        code,
        retryAfter: Math.min(3600, Math.max(60, Number(response.headers.get('Retry-After')) || 60)),
      };
    if (response.status >= 400 && response.status < 500 && data.error && !id)
      return { type: 'rejected', code };
    // A API não oferece aqui uma chave de idempotência documentada: timeout, 5xx
    // e 2xx malformado exigem conciliação, não um novo POST automático.
    return { type: 'unknown', code };
  } catch {
    return { type: 'unknown', code: 'TRANSPORT_UNCERTAIN' };
  }
}
