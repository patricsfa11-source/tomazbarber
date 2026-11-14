import type { Shop } from '../../shared';
import type { WhatsAppStatus } from '../../whatsapp';
import { configuration, type WhatsAppEnv } from './meta';
import { whatsappShop } from './queue';
export async function whatsappStatus(env: WhatsAppEnv, shop: Shop): Promise<WhatsAppStatus> {
  let configured = false,
    testRecipient: string | null = null;
  if (shop.id === whatsappShop) {
    try {
      const cfg = configuration(env);
      configured = true;
      testRecipient = `+55 (${cfg.recipient.slice(3, 5)}) •••••-${cfg.recipient.slice(-4)}`;
    } catch {
      /* Somente o estado é exposto, nunca os valores das credenciais. */
    }
  }
  const { results } = await env.DB.prepare(
    `SELECT id,kind,appointment_id,state,attempts,next_attempt_at,last_error_code,created_at,provider_id,expires_at,payload IS NOT NULL AS has_payload, CASE WHEN appointment_id IS NULL THEN 1 ELSE EXISTS (SELECT 1 FROM appointments a WHERE a.shop_id=whatsapp_deliveries.shop_id AND a.id=appointment_id AND a.version=booking_version AND a.status=CASE WHEN kind='cancellation' THEN 'cancelled' ELSE 'confirmed' END) END AS current_match, CASE WHEN challenge_id IS NULL THEN 1 ELSE EXISTS (SELECT 1 FROM phone_challenges c WHERE c.id=challenge_id AND c.consumed_by IS NULL AND c.invalidated_at IS NULL AND c.expires_at>unixepoch()) END AS challenge_match FROM whatsapp_deliveries WHERE shop_id=? ORDER BY created_at DESC,id DESC LIMIT 50`,
  )
    .bind(shop.id)
    .all<
      WhatsAppStatus['deliveries'][number] & {
        provider_id: string | null;
        expires_at: number;
        has_payload: number;
        current_match: number;
        challenge_match: number;
      }
    >();
  return {
    configured,
    mode: configured ? 'test' : 'off',
    testRecipient,
    deliveries: results.map(
      ({ provider_id, expires_at, has_payload, current_match, challenge_match, ...d }) => ({
        ...d,
        canRetry:
          configured &&
          d.state === 'failed' &&
          !provider_id &&
          d.attempts < 5 &&
          !!has_payload &&
          !!current_match &&
          !!challenge_match &&
          expires_at > Math.floor(Date.now() / 1000) &&
          /^\d+$/.test(d.last_error_code || ''),
      }),
    ),
  };
}
