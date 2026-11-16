import { ApiError } from './errors';
import type { ManagedService, Shop } from '../shared';

export async function managedServices(db: D1Database, shop: Shop): Promise<ManagedService[]> {
  const { results } = await db
    .prepare(
      'SELECT id,name,duration,price,description,payment_conditions AS paymentConditions,active,version FROM services WHERE shop_id=? ORDER BY sort_order,id',
    )
    .bind(shop.id)
    .all<Omit<ManagedService, 'active'> & { active: number }>();
  return results.map((s) => ({ ...s, active: Boolean(s.active) }));
}
export async function saveService(
  db: D1Database,
  shop: Shop,
  id: string | undefined,
  data: Record<string, unknown>,
) {
  function text(key: string, max: number, required = false) {
    const value = data[key];
    if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim()))
      throw new ApiError(400, 'Confira nome, preço e condições do serviço.');
    return value.trim();
  }
  const name = text('name', 100, true),
    price = text('price', 200, true),
    description = text('description', 300),
    conditions = text('paymentConditions', 300),
    duration = data.duration;
  if (
    typeof duration !== 'number' ||
    !Number.isInteger(duration) ||
    duration < 10 ||
    duration > 240 ||
    duration % 10 !== 0 ||
    typeof data.active !== 'boolean'
  )
    throw new ApiError(
      400,
      'Use uma duração de 10 a 240 minutos, em passos de 10, e confira a situação do serviço.',
    );
  if (id) {
    if (!Number.isSafeInteger(data.expectedVersion) || Number(data.expectedVersion) < 1)
      throw new ApiError(400, 'Reabra o serviço antes de salvar.');
    const result = await db
      .prepare(
        'UPDATE services SET name=?,duration=?,price=?,description=?,payment_conditions=?,active=?,version=version+1 WHERE shop_id=? AND id=? AND version=?',
      )
      .bind(
        name,
        duration,
        price,
        description,
        conditions,
        Number(data.active),
        shop.id,
        id,
        data.expectedVersion,
      )
      .run();
    if (!result.meta.changes) {
      if (
        !(await db
          .prepare('SELECT id FROM services WHERE shop_id=? AND id=?')
          .bind(shop.id, id)
          .first())
      )
        throw new ApiError(404, 'Serviço não encontrado neste estabelecimento.');
      throw new ApiError(
        409,
        'Este serviço mudou em outra tela. Reabra e confira antes de salvar.',
      );
    }
  } else {
    id = `servico-${crypto.randomUUID()}`;
    await db
      .prepare(
        'INSERT INTO services(shop_id,id,name,duration,price,description,payment_conditions,active,sort_order) VALUES (?,?,?,?,?,?,?,?,(SELECT COALESCE(MAX(sort_order),0)+1 FROM services WHERE shop_id=?))',
      )
      .bind(
        shop.id,
        id,
        name,
        duration,
        price,
        description,
        conditions,
        Number(data.active),
        shop.id,
      )
      .run();
  }
  return { service: (await managedServices(db, shop)).find((s) => s.id === id)! };
}
