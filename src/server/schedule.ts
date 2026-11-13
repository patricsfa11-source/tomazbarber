import { addDays, localDate } from '../shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function validateDate(date: unknown, now = Date.now()): asserts date is string {
  if (
    typeof date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(`${date}T12:00:00-03:00`)) ||
    new Date(`${date}T12:00:00-03:00`).toISOString().slice(0, 10) !== date ||
    date < localDate(new Date(now)) ||
    date > addDays(localDate(new Date(now)), 90)
  ) {
    throw new ApiError(400, 'Escolha uma data válida nos próximos 90 dias.');
  }
}
export function dayBounds(date: string): [number, number] {
  return [Date.parse(`${date}T07:30:00-03:00`) / 1000, Date.parse(`${date}T20:00:00-03:00`) / 1000];
}
export function candidates(date: string, duration: number, now = Date.now()): number[] {
  if (new Date(`${date}T12:00:00-03:00`).getUTCDay() === 0) return [];
  const [open, close] = dayBounds(date);
  const slots: number[] = [];
  for (let start = open; start + duration * 60 <= close; start += 600) {
    if (start * 1000 > now) slots.push(start);
  }
  return slots;
}
export async function available(db: D1Database, date: string, duration: number): Promise<number[]> {
  const [open, close] = dayBounds(date);
  const { results } = await db
    .prepare('SELECT starts_at, ends_at FROM appointments WHERE starts_at < ? AND ends_at > ?')
    .bind(close, open)
    .all<{ starts_at: number; ends_at: number }>();
  return candidates(date, duration).filter(
    (start) => !results.some((a) => start < a.ends_at && start + duration * 60 > a.starts_at),
  );
}
