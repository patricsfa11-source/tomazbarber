import { addDays, localDate, localInstant, timezone, type Shop } from '../shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function validateDate(
  date: unknown,
  now = Date.now(),
  zone = timezone,
): asserts date is string {
  if (
    typeof date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) ||
    new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date ||
    date < localDate(new Date(now), zone) ||
    date > addDays(localDate(new Date(now), zone), 90)
  )
    throw new ApiError(400, 'Escolha uma data válida nos próximos 90 dias.');
}
export function dayBounds(date: string, zone = timezone): [number, number] {
  return [localInstant(date, 0, zone), localInstant(addDays(date, 1), 0, zone)];
}
export function candidates(
  date: string,
  duration: number,
  now = Date.now(),
  shop?: Shop,
): number[] {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const hours = shop
    ? shop.hours.find((h) => h.weekday === weekday)
    : weekday !== 0
      ? { opensAt: 450, closesAt: 1200 }
      : undefined;
  if (!hours) return [];
  const open = localInstant(date, hours.opensAt, shop?.timezone);
  const close = localInstant(date, hours.closesAt, shop?.timezone);
  const slots: number[] = [];
  for (let start = open; start + duration * 60 <= close; start += 600)
    if (start * 1000 > now) slots.push(start);
  return slots;
}
export async function available(
  db: D1Database,
  shop: Shop,
  date: string,
  duration: number,
): Promise<number[]> {
  const [open, close] = dayBounds(date, shop.timezone);
  const { results } = await db
    .prepare(
      'SELECT starts_at, ends_at FROM appointments WHERE shop_id = ? AND professional_id = ? AND starts_at < ? AND ends_at > ?',
    )
    .bind(shop.id, 'principal', close, open)
    .all<{ starts_at: number; ends_at: number }>();
  return candidates(date, duration, Date.now(), shop).filter(
    (start) => !results.some((a) => start < a.ends_at && start + duration * 60 > a.starts_at),
  );
}
