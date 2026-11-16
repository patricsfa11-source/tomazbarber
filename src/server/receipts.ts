import { addDays, localDate, type Shop } from '../shared';
import type { ReceiptRecord, ReceiptReport, ReceiptGroup } from '../finance';
import { paymentMethods } from '../finance';
import { ApiError } from './errors';
import { getAppointment } from './appointments';
import { hash } from './crypto';

const columns =
  'id,appointment_id,customer_id,customer_name,service_id,service_name,amount_cents,paid_on,method,created_at';
function requestKey(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/i.test(value))
    throw new ApiError(400, 'Reabra o formulário para registrar a ação.');
}
function validDate(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(`${value}T12:00:00Z`)) ||
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value ||
    value < '2000-01-01'
  )
    throw new ApiError(400, 'Informe uma data válida.');
}
export async function completeAppointment(
  db: D1Database,
  shop: Shop,
  id: string,
  data: Record<string, unknown>,
) {
  requestKey(data.requestKey);
  const a = await getAppointment(db, shop, id);
  const replay = () =>
    db
      .prepare('SELECT id FROM appointments WHERE shop_id=? AND completion_key=?')
      .bind(shop.id, data.requestKey)
      .first<{ id: string }>();
  const repeated = await replay();
  if (repeated && repeated.id !== id)
    throw new ApiError(409, 'Esta solicitação já concluiu outro atendimento.');
  if (a.completed_at) return { completedAt: a.completed_at, replayed: true };
  if (!Number.isSafeInteger(data.expectedVersion) || data.expectedVersion !== a.version)
    throw new ApiError(409, 'A reserva mudou. Reabra o atendimento antes de concluir.');
  if (a.status !== 'confirmed' || a.starts_at > Math.floor(Date.now() / 1000))
    throw new ApiError(409, 'Só é possível concluir um atendimento confirmado que já começou.');
  try {
    const result = await db
      .prepare(
        "UPDATE appointments SET completed_at=unixepoch(),completion_key=?,version=version+1 WHERE shop_id=? AND id=? AND status='confirmed' AND completed_at IS NULL AND version=? AND starts_at<=unixepoch() RETURNING completed_at",
      )
      .bind(data.requestKey, shop.id, id, data.expectedVersion)
      .first<{ completed_at: number }>();
    if (result) return { completedAt: result.completed_at, replayed: false };
  } catch (error) {
    if (!String(error).includes('UNIQUE constraint failed: appointments.')) throw error;
  }
  const current = await getAppointment(db, shop, id);
  if (current.completed_at) return { completedAt: current.completed_at, replayed: true };
  throw new ApiError(409, 'A reserva mudou enquanto você concluía. Recarregue a agenda.');
}
export async function getReceipt(db: D1Database, shop: Shop, id: string) {
  return db
    .prepare(`SELECT ${columns} FROM receipts WHERE shop_id=? AND appointment_id=?`)
    .bind(shop.id, id)
    .first<ReceiptRecord>();
}
export async function registerReceipt(
  db: D1Database,
  shop: Shop,
  id: string,
  data: Record<string, unknown>,
) {
  requestKey(data.requestKey);
  validDate(data.paidOn);
  const today = localDate(new Date(), shop.timezone);
  if (data.paidOn > today) throw new ApiError(400, 'O recebimento não pode ter uma data futura.');
  if (
    typeof data.amountCents !== 'number' ||
    !Number.isSafeInteger(data.amountCents) ||
    data.amountCents < 1 ||
    data.amountCents > 99999999
  )
    throw new ApiError(400, 'Informe o valor recebido, entre R$ 0,01 e R$ 999.999,99.');
  if (typeof data.method !== 'string' || !Object.hasOwn(paymentMethods, data.method))
    throw new ApiError(400, 'Escolha Pix, dinheiro ou cartão.');
  await getAppointment(db, shop, id);
  const fingerprint = await hash(JSON.stringify([id, data.amountCents, data.paidOn, data.method]));
  const existing = () =>
    db
      .prepare(
        `SELECT ${columns},fingerprint FROM receipts WHERE shop_id=? AND (request_key=? OR appointment_id=?)`,
      )
      .bind(shop.id, data.requestKey, id)
      .all<ReceiptRecord & { fingerprint: string }>();
  const replay = async () => {
    const { results } = await existing();
    if (!results.length) return null;
    if (results.some((r) => r.appointment_id !== id || r.fingerprint !== fingerprint))
      throw new ApiError(
        409,
        'Já existe um recebimento ou esta solicitação foi usada com outros dados. Nenhum valor foi duplicado.',
      );
    return { receipt: await getReceipt(db, shop, id), replayed: true };
  };
  const previous = await replay();
  if (previous) return previous;
  try {
    await db
      .prepare(
        `INSERT INTO receipts(id,shop_id,appointment_id,customer_id,customer_name,service_id,service_name,amount_cents,paid_on,method,request_key,fingerprint) SELECT ?,shop_id,id,customer_id,customer_name,service_id,service_name,?,?,?,?,? FROM appointments WHERE shop_id=? AND id=?`,
      )
      .bind(
        crypto.randomUUID(),
        data.amountCents,
        data.paidOn,
        data.method,
        data.requestKey,
        fingerprint,
        shop.id,
        id,
      )
      .run();
  } catch (error) {
    const repeated = await replay();
    if (repeated) return repeated;
    throw error;
  }
  return { receipt: await getReceipt(db, shop, id), replayed: false };
}
export async function receiptReport(db: D1Database, shop: Shop, url: URL): Promise<ReceiptReport> {
  const today = localDate(new Date(), shop.timezone),
    month = `${today.slice(0, 7)}-01`;
  const from = url.searchParams.get('from') || month,
    to = url.searchParams.get('to') || today;
  validDate(from);
  validDate(to);
  if (from > to || to > today || to > addDays(from, 365))
    throw new ApiError(400, 'Escolha um período de até 366 dias, sem datas futuras.');
  const cursor = url.searchParams.get('cursor');
  const match = cursor?.match(/^(\d{4}-\d{2}-\d{2}):([a-f0-9-]{36})$/);
  if (cursor && !match) throw new ApiError(400, 'Página de recebimentos inválida.');
  const statements = [
    db
      .prepare(
        'SELECT COALESCE(SUM(CASE WHEN paid_on=? THEN amount_cents ELSE 0 END),0) AS today_cents,COALESCE(SUM(amount_cents),0) AS month_cents FROM receipts WHERE shop_id=? AND paid_on>=? AND paid_on<=?',
      )
      .bind(today, shop.id, month, today),
    db
      .prepare(
        'SELECT COALESCE(SUM(amount_cents),0) AS total_cents,COUNT(*) AS count FROM receipts WHERE shop_id=? AND paid_on BETWEEN ? AND ?',
      )
      .bind(shop.id, from, to),
    ...[
      ['customer_id', 'customer_name'],
      ['service_id', 'service_name'],
      ['method', 'method'],
    ].map(([id, name]) =>
      db
        .prepare(
          `SELECT ${id} AS id,MAX(${name}) AS name,SUM(amount_cents) AS total_cents,COUNT(*) AS count FROM receipts WHERE shop_id=? AND paid_on BETWEEN ? AND ? GROUP BY ${id} ORDER BY total_cents DESC,id`,
        )
        .bind(shop.id, from, to),
    ),
    db
      .prepare(
        `SELECT ${columns} FROM receipts WHERE shop_id=? AND paid_on BETWEEN ? AND ?${match ? ' AND (paid_on<? OR (paid_on=? AND id<?))' : ''} ORDER BY paid_on DESC,id DESC LIMIT 51`,
      )
      .bind(shop.id, from, to, ...(match ? [match[1], match[1], match[2]] : [])),
  ];
  const results = await db.batch(statements);
  const receipts = results[5].results.slice(0, 50) as unknown as ReceiptRecord[];
  const last = receipts.at(-1);
  return {
    today,
    from,
    to,
    ...(results[0].results[0] as { today_cents: number; month_cents: number }),
    ...(results[1].results[0] as { total_cents: number; count: number }),
    clients: results[2].results as unknown as ReceiptGroup[],
    services: results[3].results as unknown as ReceiptGroup[],
    methods: results[4].results as unknown as ReceiptGroup[],
    receipts,
    nextCursor: results[5].results.length > 50 && last ? `${last.paid_on}:${last.id}` : null,
  } as ReceiptReport;
}
