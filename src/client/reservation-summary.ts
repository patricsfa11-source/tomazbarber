import { dateLabel, localDate, timeLabel, type Shop } from '../shared';
import type { CustomerBooking } from '../customer';
type Summary = Pick<
  CustomerBooking,
  'id' | 'service' | 'price' | 'duration' | 'startsAt' | 'endsAt' | 'status'
>;
export function reservationSummary(
  a: Summary,
  shop: Shop,
  e: (v: unknown) => string,
  classes = 'my-booking-summary',
) {
  const status =
    a.status === 'cancelled' ? 'Cancelada' : a.status === 'completed' ? 'Concluído' : 'Confirmada';
  const [price, ...conditions] = a.price.split(' · ');
  return `<div class="reservation-summary ${classes}"><span class="reservation-status status ${a.status === 'cancelled' ? 'cancelled' : ''}">${status}</span><h2>${e(a.service)}</h2><p class="reservation-date">${e(dateLabel(localDate(new Date(a.startsAt * 1000), shop.timezone), shop.timezone))}</p><strong class="reservation-interval">${timeLabel(a.startsAt, shop.timezone)}–${timeLabel(a.endsAt, shop.timezone)}</strong><div class="reservation-price"><p>${e(price)}</p>${conditions.length ? `<p class="muted">${e(conditions.join(' · '))}</p>` : ''}<p class="note">${a.duration} minutos · Pagamento no atendimento</p></div><small class="reservation-code">Reserva ${e(a.id.slice(0, 8).toUpperCase())}</small></div>`;
}
