import { ApiError } from './errors';
import { normalizePhone } from './phone';
import type { Shop } from '../shared';
export function customerInput(data: Record<string, unknown>) {
  if (typeof data.name !== 'string' || typeof data.phone !== 'string')
    throw new ApiError(400, 'Informe nome completo e celular com DDD.');
  const name = data.name.trim().replace(/\s+/g, ' ');
  if (
    name.length < 5 ||
    name.length > 100 ||
    !/^\p{L}[\p{L}\p{M}'’-]+(?: [\p{L}\p{M}'’-]+)+$/u.test(name)
  )
    throw new ApiError(400, 'Informe seu nome completo.');
  return { name, phone: normalizePhone(data.phone) };
}
export async function registerCustomer(db: D1Database, shop: Shop, data: Record<string, unknown>) {
  const input = customerInput(data);
  await db
    .prepare(
      'INSERT INTO customers(shop_id,id,full_name,phone) VALUES (?,?,?,?) ON CONFLICT(shop_id,phone) DO NOTHING',
    )
    .bind(shop.id, crypto.randomUUID(), input.name, input.phone)
    .run();
  const customer = await db
    .prepare('SELECT id,full_name,phone FROM customers WHERE shop_id=? AND phone=?')
    .bind(shop.id, input.phone)
    .first<{ id: string; full_name: string; phone: string }>();
  if (!customer || customer.full_name !== input.name)
    throw new ApiError(
      409,
      'Já existe um cliente com esse celular neste estabelecimento. Confira o cadastro.',
    );
  return { customer };
}
