import type { AppointmentDetail, AppointmentRecord, BookingEvent } from '../calendar';
import { localDate, type Shop } from '../shared';
import { ApiError } from './errors';
import { hash } from './crypto';
import { getSchedule, scheduleCandidates } from './schedule-management';
import { validateDate } from './schedule';

export const appointmentColumns =
  'id,shop_id,professional_id,customer_id,customer_name,customer_phone,service_name,price_label,duration_minutes,starts_at,ends_at,origin,booking_channel,status,version,cancelled_at';
export async function getAppointment(
  db: D1Database,
  shop: Shop,
  id: string,
): Promise<AppointmentRecord> {
  const appointment = await db
    .prepare(`SELECT ${appointmentColumns} FROM appointments WHERE shop_id=? AND id=?`)
    .bind(shop.id, id)
    .first<AppointmentRecord>();
  if (!appointment) throw new ApiError(404, 'Reserva não encontrada neste estabelecimento.');
  return appointment;
}
export async function appointmentDetail(
  db: D1Database,
  shop: Shop,
  id: string,
): Promise<AppointmentDetail> {
  const result = await db.batch([
    db
      .prepare(`SELECT ${appointmentColumns} FROM appointments WHERE shop_id=? AND id=?`)
      .bind(shop.id, id),
    db
      .prepare(
        'SELECT id,version,kind,old_start,old_end,new_start,new_end,created_at FROM booking_events WHERE shop_id=? AND appointment_id=? ORDER BY version',
      )
      .bind(shop.id, id),
    db
      .prepare(
        'SELECT booking_version,state,due_at FROM appointment_reminders WHERE shop_id=? AND appointment_id=?',
      )
      .bind(shop.id, id),
  ]);
  const appointment = result[0].results[0] as unknown as AppointmentRecord | undefined;
  if (!appointment) throw new ApiError(404, 'Reserva não encontrada neste estabelecimento.');
  return {
    appointment,
    events: result[1].results as unknown as BookingEvent[],
    reminder: (result[2].results[0] ?? null) as AppointmentDetail['reminder'],
  };
}
export async function mutateAppointment(
  db: D1Database,
  shop: Shop,
  id: string,
  kind: 'reschedule' | 'cancel',
  data: Record<string, unknown>,
) {
  const { requestKey, expectedVersion } = data;
  if (
    typeof requestKey !== 'string' ||
    !/^[a-f0-9-]{36}$/i.test(requestKey) ||
    typeof expectedVersion !== 'number' ||
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 1
  )
    throw new ApiError(400, 'Recarregue a reserva antes de confirmar a alteração.');
  const target = kind === 'reschedule' ? data.startsAt : null;
  if (
    kind === 'reschedule' &&
    (typeof target !== 'number' ||
      !Number.isSafeInteger(target) ||
      !Number.isFinite(new Date(target * 1000).getTime()))
  )
    throw new ApiError(400, 'Escolha o novo horário.');
  const fingerprint = await hash(JSON.stringify({ id, kind, expectedVersion, startsAt: target }));
  const current = await getAppointment(db, shop, id);
  const replay = async () => {
    const event = await db
      .prepare(
        'SELECT appointment_id,version,kind,new_start,new_end,created_at,action_fingerprint FROM booking_events WHERE shop_id=? AND action_key=?',
      )
      .bind(shop.id, requestKey)
      .first<{
        appointment_id: string;
        version: number;
        kind: string;
        new_start: number;
        new_end: number;
        action_fingerprint: string;
        created_at: number;
      }>();
    if (!event) return null;
    if (event.appointment_id !== id || event.action_fingerprint !== fingerprint)
      throw new ApiError(409, 'Esta solicitação já foi usada para outra alteração.');
    return {
      appointment: {
        ...current,
        version: event.version,
        starts_at: event.new_start,
        ends_at: event.new_end,
        status: event.kind === 'cancelled' ? 'cancelled' : 'confirmed',
        cancelled_at: event.kind === 'cancelled' ? event.created_at : null,
      },
      replayed: true,
    };
  };
  const repeated = await replay();
  if (repeated) return repeated;
  if (current.version !== expectedVersion || current.status !== 'confirmed')
    throw new ApiError(409, 'Esta reserva já foi alterada ou cancelada. Recarregue os dados.');
  let start = current.starts_at,
    revision = 0;
  if (kind === 'reschedule') {
    start = target as number;
    if (start === current.starts_at)
      throw new ApiError(400, 'Escolha um horário diferente do atual.');
    const date = localDate(new Date(start * 1000), shop.timezone);
    validateDate(date, Date.now(), shop.timezone);
    const config = await getSchedule(db, shop);
    revision = config.revision;
    if (!scheduleCandidates(config, shop, date, current.duration_minutes, 'hub').includes(start))
      throw new ApiError(
        400,
        'O novo horário não cabe na disponibilidade do hub. A reserva original foi preservada.',
      );
  }
  try {
    const statement =
      kind === 'reschedule'
        ? db
            .prepare(
              `UPDATE appointments SET starts_at=?,ends_at=?,booking_channel='hub',schedule_revision=?,version=version+1,action_key=?,action_fingerprint=? WHERE shop_id=? AND id=? AND version=? AND status='confirmed' RETURNING ${appointmentColumns}`,
            )
            .bind(
              start,
              start + current.duration_minutes * 60,
              revision,
              requestKey,
              fingerprint,
              shop.id,
              id,
              expectedVersion,
            )
        : db
            .prepare(
              `UPDATE appointments SET status='cancelled',cancelled_at=unixepoch(),version=version+1,action_key=?,action_fingerprint=? WHERE shop_id=? AND id=? AND version=? AND status='confirmed' RETURNING ${appointmentColumns}`,
            )
            .bind(requestKey, fingerprint, shop.id, id, expectedVersion);
    const appointment = await statement.first<AppointmentRecord>();
    if (!appointment) {
      const repeated = await replay();
      if (repeated) return repeated;
      throw new ApiError(409, 'A reserva mudou enquanto você confirmava. Recarregue os dados.');
    }
    return { appointment, replayed: false };
  } catch (error) {
    const repeated = await replay();
    if (repeated) return repeated;
    if (String(error).includes('UNIQUE constraint failed: occupied_segments.'))
      throw new ApiError(409, 'O novo intervalo está ocupado. A reserva original foi preservada.');
    if (String(error).includes('SCHEDULE_CHANGED'))
      throw new ApiError(
        409,
        'A disponibilidade mudou. Confira os horários; a reserva original foi preservada.',
      );
    throw error;
  }
}
