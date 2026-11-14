import type { Shop } from '../shared';
import type { AppointmentRecord } from '../calendar';
import type { CustomerBooking, CustomerBookings } from '../customer';
import { appointmentColumns, getAppointment } from './appointments';
import { ApiError } from './errors';

export function customerReceipt(a: AppointmentRecord): CustomerBooking {
  const canChange = a.status === 'confirmed' && a.starts_at >= Math.floor(Date.now() / 1000) + 7200;
  return {
    id: a.id,
    service: a.service_name,
    price: a.price_label,
    duration: a.duration_minutes,
    startsAt: a.starts_at,
    endsAt: a.ends_at,
    status: a.status,
    version: a.version,
    canCancel: canChange,
    canReschedule: canChange,
  };
}
export async function ownedAppointment(db: D1Database, shop: Shop, id: string, phone: string) {
  const a = await getAppointment(db, shop, id);
  if (a.customer_phone !== phone)
    throw new ApiError(404, 'Reserva não encontrada neste estabelecimento.');
  return a;
}
export async function customerBookings(
  db: D1Database,
  shop: Shop,
  phone: string,
  url: URL,
): Promise<CustomerBookings> {
  const view = url.searchParams.get('view') || 'upcoming';
  if (!['upcoming', 'history'].includes(view))
    throw new ApiError(400, 'Lista de horários inválida.');
  const cursor = url.searchParams.get('cursor');
  const match = cursor?.match(/^(\d+):([a-z0-9_-]{1,100})$/i);
  if (cursor && (!match || !Number.isSafeInteger(Number(match[1]))))
    throw new ApiError(400, 'Página de horários inválida.');
  const upcoming = view === 'upcoming';
  const comparison = upcoming ? '>' : '<';
  const order = upcoming ? 'ASC' : 'DESC';
  const { results } = await db
    .prepare(
      `SELECT ${appointmentColumns} FROM appointments WHERE shop_id=? AND customer_phone=? AND ${upcoming ? "status='confirmed' AND starts_at>unixepoch()" : "(status='cancelled' OR starts_at<=unixepoch())"}${match ? ` AND (starts_at ${comparison} ? OR (starts_at=? AND id ${comparison} ?))` : ''} ORDER BY starts_at ${order},id ${order} LIMIT 51`,
    )
    .bind(shop.id, phone, ...(match ? [Number(match[1]), Number(match[1]), match[2]] : []))
    .all<AppointmentRecord>();
  const rows = results.slice(0, 50),
    last = rows.at(-1);
  return {
    appointments: rows.map(customerReceipt),
    nextCursor: results.length > 50 && last ? `${last.starts_at}:${last.id}` : null,
  };
}
