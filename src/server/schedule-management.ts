import { addDays, localDate, localInstant, type Shop } from '../shared';
import type {
  ScheduleConfig,
  ScheduleCommand,
  Weekday,
  Pause,
  SpecialHours,
  AvailabilityRule,
  AffectedBooking,
  ScheduleView,
} from '../calendar';
import { ApiError } from './errors';
import { hash } from './crypto';

const professional = 'principal';
export async function getSchedule(db: D1Database, shop: Shop): Promise<ScheduleConfig> {
  const result = await db.batch([
    db
      .prepare(
        'SELECT revision,agenda_revision AS agendaRevision FROM schedule_settings WHERE shop_id=? AND professional_id=?',
      )
      .bind(shop.id, professional),
    db
      .prepare(
        'SELECT weekday,opens_at AS opensAt,closes_at AS closesAt FROM working_hours WHERE shop_id=? AND professional_id=? ORDER BY weekday',
      )
      .bind(shop.id, professional),
    db
      .prepare(
        'SELECT weekday,starts_at AS startsAt,ends_at AS endsAt FROM weekly_breaks WHERE shop_id=? AND professional_id=? ORDER BY weekday,starts_at',
      )
      .bind(shop.id, professional),
    db
      .prepare(
        'SELECT id,from_date AS "from",to_date AS "to",closed,opens_at AS opensAt,closes_at AS closesAt,breaks_json FROM special_hours WHERE shop_id=? AND professional_id=? ORDER BY from_date,id',
      )
      .bind(shop.id, professional),
    db
      .prepare(
        'SELECT id,from_date AS "from",to_date AS "to",starts_at AS startsAt,ends_at AS endsAt,scope FROM availability_rules WHERE shop_id=? AND professional_id=? ORDER BY from_date,starts_at,id',
      )
      .bind(shop.id, professional),
  ]);
  const settings = result[0].results[0] as unknown as
    { revision: number; agendaRevision: number } | undefined;
  if (!settings) throw new ApiError(503, 'Configuração da agenda indisponível.');
  const hours = result[1].results as unknown as {
    weekday: number;
    opensAt: number;
    closesAt: number;
  }[];
  const pauses = result[2].results as unknown as (Pause & { weekday: number })[];
  const specials = (
    result[3].results as unknown as (Omit<SpecialHours, 'breaks' | 'closed'> & {
      closed: number;
      breaks_json: string;
    })[]
  ).map((row) => ({
    id: row.id,
    from: row.from,
    to: row.to,
    closed: Boolean(row.closed),
    opensAt: row.opensAt,
    closesAt: row.closesAt,
    breaks: JSON.parse(row.breaks_json) as Pause[],
  }));
  const days = Array.from({ length: 7 }, (_, weekday) => {
    const h = hours.find((h) => h.weekday === weekday);
    return {
      weekday,
      enabled: Boolean(h),
      opensAt: h?.opensAt ?? 450,
      closesAt: h?.closesAt ?? 1200,
      breaks: pauses
        .filter((p) => p.weekday === weekday)
        .map(({ startsAt, endsAt }) => ({ startsAt, endsAt })),
    };
  });
  return { ...settings, days, specials, rules: result[4].results as unknown as AvailabilityRule[] };
}
export function windows(config: ScheduleConfig, date: string, channel: 'link' | 'hub'): Pause[] {
  const special = config.specials
    .filter((s) => s.from <= date && s.to >= date)
    .sort(
      (a, b) =>
        Date.parse(a.to) - Date.parse(a.from) - (Date.parse(b.to) - Date.parse(b.from)) ||
        b.id - a.id,
    )[0];
  const day = config.days.find((d) => d.weekday === new Date(`${date}T12:00:00Z`).getUTCDay());
  const hours = special ? { enabled: !special.closed, ...special } : day;
  if (!hours?.enabled) return [];
  let result: Pause[] = [{ startsAt: hours.opensAt, endsAt: hours.closesAt }];
  const exclusions = [
    ...hours.breaks,
    ...config.rules.filter(
      (r) => r.from <= date && r.to >= date && (r.scope === 'all' || channel === 'link'),
    ),
  ];
  for (const exclusion of exclusions) {
    result = result.flatMap((window) => {
      if (exclusion.startsAt >= window.endsAt || exclusion.endsAt <= window.startsAt)
        return [window];
      const pieces: Pause[] = [];
      if (exclusion.startsAt > window.startsAt)
        pieces.push({ startsAt: window.startsAt, endsAt: exclusion.startsAt });
      if (exclusion.endsAt < window.endsAt)
        pieces.push({ startsAt: exclusion.endsAt, endsAt: window.endsAt });
      return pieces;
    });
  }
  return result;
}
export function fits(
  config: ScheduleConfig,
  shop: Shop,
  start: number,
  end: number,
  channel: 'link' | 'hub',
): boolean {
  const date = localDate(new Date(start * 1000), shop.timezone);
  return windows(config, date, channel).some(
    (w) =>
      start >= localInstant(date, w.startsAt, shop.timezone) &&
      end <= localInstant(date, w.endsAt, shop.timezone),
  );
}
export function scheduleCandidates(
  config: ScheduleConfig,
  shop: Shop,
  date: string,
  duration: number,
  channel: 'link' | 'hub',
  now = Date.now(),
): number[] {
  return windows(config, date, channel).flatMap((w) => {
    const slots: number[] = [];
    const close = localInstant(date, w.endsAt, shop.timezone);
    for (
      let start = localInstant(date, w.startsAt, shop.timezone);
      start + duration * 60 <= close;
      start += 600
    )
      if (start * 1000 > now) slots.push(start);
    return slots;
  });
}
export async function affectedBookings(
  db: D1Database,
  shop: Shop,
  config: ScheduleConfig,
): Promise<AffectedBooking[]> {
  const { results } = await db
    .prepare(
      "SELECT id,customer_name,service_name,starts_at,ends_at,version,booking_channel FROM appointments WHERE shop_id=? AND professional_id=? AND status='confirmed' AND starts_at>=unixepoch() ORDER BY starts_at,id",
    )
    .bind(shop.id, professional)
    .all<AffectedBooking>();
  return results.filter((a) => !fits(config, shop, a.starts_at, a.ends_at, a.booking_channel));
}
export async function scheduleView(db: D1Database, shop: Shop): Promise<ScheduleView> {
  const config = await getSchedule(db, shop);
  return { ...config, affected: await affectedBookings(db, shop, config) };
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ApiError(400, 'Confira os dados da configuração.');
  return value as Record<string, unknown>;
};
function minute(value: unknown, end = false): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > (end ? 1440 : 1430) ||
    value % 10 !== 0
  )
    throw new ApiError(400, 'Use horários de 10 em 10 minutos, entre 00h e 24h.');
  return value;
}
function pauses(value: unknown, open: number, close: number): Pause[] {
  if (!Array.isArray(value) || value.length > 8)
    throw new ApiError(400, 'Informe até 8 pausas por dia.');
  const result = value
    .map((p) => {
      const o = object(p);
      return { startsAt: minute(o.startsAt), endsAt: minute(o.endsAt, true) };
    })
    .sort((a, b) => a.startsAt - b.startsAt);
  if (
    result.some(
      (p, i) =>
        p.startsAt < open ||
        p.endsAt > close ||
        p.endsAt <= p.startsAt ||
        (i > 0 && p.startsAt < result[i - 1].endsAt),
    )
  )
    throw new ApiError(400, 'As pausas devem caber no expediente e não podem se sobrepor.');
  return result;
}
function range(from: unknown, to: unknown, shop: Shop): { from: string; to: string } {
  const valid = (date: unknown): date is string =>
    typeof date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(`${date}T12:00:00Z`)) &&
    new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date;
  const today = localDate(new Date(), shop.timezone);
  if (!valid(from) || !valid(to) || from < today || to < from || to > addDays(today, 90))
    throw new ApiError(400, 'Escolha uma data ou período válido nos próximos 90 dias.');
  return { from, to };
}
export function parseCommand(value: unknown, shop: Shop): ScheduleCommand {
  const data = object(value);
  if (data.kind === 'weekly') {
    if (!Array.isArray(data.days) || data.days.length !== 7)
      throw new ApiError(400, 'Informe os sete dias da semana.');
    const days: Weekday[] = data.days
      .map((value) => {
        const d = object(value);
        if (
          typeof d.weekday !== 'number' ||
          !Number.isInteger(d.weekday) ||
          d.weekday < 0 ||
          d.weekday > 6 ||
          typeof d.enabled !== 'boolean'
        )
          throw new ApiError(400, 'Dia da semana inválido.');
        const opensAt = minute(d.opensAt),
          closesAt = minute(d.closesAt, true);
        if (closesAt <= opensAt)
          throw new ApiError(400, 'O fechamento deve ser depois da abertura.');
        return {
          weekday: d.weekday,
          enabled: d.enabled,
          opensAt,
          closesAt,
          breaks: d.enabled ? pauses(d.breaks, opensAt, closesAt) : [],
        };
      })
      .sort((a, b) => a.weekday - b.weekday);
    if (new Set(days.map((d) => d.weekday)).size !== 7)
      throw new ApiError(400, 'Informe cada dia da semana uma única vez.');
    return { kind: 'weekly', days };
  }
  if (data.kind === 'special') {
    const dates = range(data.from, data.to, shop);
    if (typeof data.closed !== 'boolean')
      throw new ApiError(400, 'Informe se o dia estará fechado.');
    const opensAt = data.closed ? 0 : minute(data.opensAt),
      closesAt = data.closed ? 1440 : minute(data.closesAt, true);
    if (closesAt <= opensAt) throw new ApiError(400, 'O fechamento deve ser depois da abertura.');
    return {
      kind: 'special',
      ...dates,
      closed: data.closed,
      opensAt,
      closesAt,
      breaks: data.closed ? [] : pauses(data.breaks, opensAt, closesAt),
    };
  }
  if (data.kind === 'rule') {
    const dates = range(data.from, data.to, shop),
      startsAt = minute(data.startsAt),
      endsAt = minute(data.endsAt, true);
    if (endsAt <= startsAt || !['online', 'all'].includes(String(data.scope)))
      throw new ApiError(400, 'Confira o intervalo e os canais do bloqueio.');
    return { kind: 'rule', ...dates, startsAt, endsAt, scope: data.scope as 'online' | 'all' };
  }
  if (data.kind === 'remove-special' || data.kind === 'remove-rule') {
    if (typeof data.id !== 'number' || !Number.isSafeInteger(data.id) || data.id < 1)
      throw new ApiError(400, 'Regra inválida.');
    return { kind: data.kind, id: data.id };
  }
  throw new ApiError(400, 'Alteração de agenda inválida.');
}
function proposed(config: ScheduleConfig, command: ScheduleCommand): ScheduleConfig {
  if (command.kind === 'weekly') return { ...config, days: command.days };
  if (command.kind === 'special')
    return {
      ...config,
      specials: [...config.specials, { id: Number.MAX_SAFE_INTEGER, ...command }],
    };
  if (command.kind === 'rule')
    return { ...config, rules: [...config.rules, { id: Number.MAX_SAFE_INTEGER, ...command }] };
  if (command.kind === 'remove-special') {
    if (!config.specials.some((s) => s.id === command.id))
      throw new ApiError(404, 'Horário especial não encontrado neste estabelecimento.');
    return { ...config, specials: config.specials.filter((s) => s.id !== command.id) };
  }
  if (!config.rules.some((r) => r.id === command.id))
    throw new ApiError(404, 'Bloqueio não encontrado neste estabelecimento.');
  return { ...config, rules: config.rules.filter((r) => r.id !== command.id) };
}
async function preview(db: D1Database, shop: Shop, data: Record<string, unknown>) {
  const command = parseCommand(data.command, shop),
    config = await getSchedule(db, shop);
  if (data.expectedRevision !== config.revision)
    throw new ApiError(409, 'A configuração mudou. Recarregue antes de revisar a alteração.');
  const affected = await affectedBookings(db, shop, proposed(config, command));
  const previewToken = await hash(
    JSON.stringify({
      shop: shop.id,
      revision: config.revision,
      agendaRevision: config.agendaRevision,
      command,
      affected,
    }),
  );
  return {
    command,
    revision: config.revision,
    agendaRevision: config.agendaRevision,
    affected,
    previewToken,
  };
}
export async function previewSchedule(db: D1Database, shop: Shop, data: Record<string, unknown>) {
  return preview(db, shop, data);
}
export async function saveSchedule(db: D1Database, shop: Shop, data: Record<string, unknown>) {
  if (typeof data.previewToken !== 'string' || !/^[a-f0-9]{64}$/.test(data.previewToken))
    throw new ApiError(400, 'Revise a prévia antes de salvar.');
  const command = parseCommand(data.command, shop),
    commandJson = JSON.stringify(command);
  const previous = await db
    .prepare('SELECT command_json FROM schedule_changes WHERE shop_id=? AND request_key=?')
    .bind(shop.id, data.previewToken)
    .first<{ command_json: string }>();
  if (previous) {
    if (previous.command_json !== commandJson)
      throw new ApiError(409, 'Esta prévia já foi usada em outra alteração.');
    return { ...(await scheduleView(db, shop)), replayed: true };
  }
  const view = await preview(db, shop, data);
  if (view.previewToken !== data.previewToken)
    throw new ApiError(
      409,
      'A agenda mudou desde a prévia. Revise novamente as reservas afetadas.',
    );
  const statements = [
    db
      .prepare(
        'INSERT INTO schedule_changes (shop_id,professional_id,request_key,expected_revision,expected_agenda_revision,command_json) VALUES (?,?,?,?,?,?)',
      )
      .bind(
        shop.id,
        professional,
        data.previewToken,
        view.revision,
        view.agendaRevision,
        commandJson,
      ),
  ];
  if (command.kind === 'weekly') {
    statements.push(
      db
        .prepare('DELETE FROM weekly_breaks WHERE shop_id=? AND professional_id=?')
        .bind(shop.id, professional),
      db
        .prepare('DELETE FROM working_hours WHERE shop_id=? AND professional_id=?')
        .bind(shop.id, professional),
    );
    for (const day of command.days.filter((d) => d.enabled)) {
      statements.push(
        db
          .prepare('INSERT INTO working_hours VALUES (?,?,?,?,?)')
          .bind(shop.id, professional, day.weekday, day.opensAt, day.closesAt),
      );
      for (const pause of day.breaks)
        statements.push(
          db
            .prepare('INSERT INTO weekly_breaks VALUES (?,?,?,?,?)')
            .bind(shop.id, professional, day.weekday, pause.startsAt, pause.endsAt),
        );
    }
  } else if (command.kind === 'special')
    statements.push(
      db
        .prepare(
          'INSERT INTO special_hours (shop_id,professional_id,from_date,to_date,closed,opens_at,closes_at,breaks_json) VALUES (?,?,?,?,?,?,?,?)',
        )
        .bind(
          shop.id,
          professional,
          command.from,
          command.to,
          Number(command.closed),
          command.opensAt,
          command.closesAt,
          JSON.stringify(command.breaks),
        ),
    );
  else if (command.kind === 'rule')
    statements.push(
      db
        .prepare(
          'INSERT INTO availability_rules (shop_id,professional_id,from_date,to_date,starts_at,ends_at,scope) VALUES (?,?,?,?,?,?,?)',
        )
        .bind(
          shop.id,
          professional,
          command.from,
          command.to,
          command.startsAt,
          command.endsAt,
          command.scope,
        ),
    );
  else
    statements.push(
      db
        .prepare(
          `DELETE FROM ${command.kind === 'remove-special' ? 'special_hours' : 'availability_rules'} WHERE shop_id=? AND professional_id=? AND id=?`,
        )
        .bind(shop.id, professional, command.id),
    );
  try {
    await db.batch(statements);
  } catch (error) {
    if (String(error).includes('SCHEDULE_CHANGED'))
      throw new ApiError(409, 'A agenda mudou. Revise novamente a prévia.');
    throw error;
  }
  return { ...(await scheduleView(db, shop)), replayed: false };
}
