import type { Service, Shop } from '../shared';
import { ApiError } from './schedule';

export const firstShop = 'tomaz-barber';
export const primaryProfessional = 'principal';
export async function getShop(db: D1Database, slug: string): Promise<Shop> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80)
    throw new ApiError(404, 'Estabelecimento não encontrado.');
  const shop = await db
    .prepare(
      'SELECT id, slug, name, timezone, logo_url AS logoUrl, description FROM shops WHERE slug = ?',
    )
    .bind(slug)
    .first<Omit<Shop, 'hours'>>();
  if (!shop) throw new ApiError(404, 'Estabelecimento não encontrado.');
  const { results: hours } = await db
    .prepare(
      'SELECT weekday, opens_at AS opensAt, closes_at AS closesAt FROM working_hours WHERE shop_id = ? AND professional_id = ? ORDER BY weekday',
    )
    .bind(shop.id, primaryProfessional)
    .all<Shop['hours'][number]>();
  return { ...shop, hours };
}
export async function getServices(db: D1Database, shopId: string): Promise<Service[]> {
  return (
    await db
      .prepare(
        'SELECT id,name,duration,price,description FROM services WHERE shop_id = ? ORDER BY sort_order,id',
      )
      .bind(shopId)
      .all<Service>()
  ).results;
}
export async function getService(db: D1Database, shopId: string, id: string): Promise<Service> {
  const service = await db
    .prepare('SELECT id,name,duration,price,description FROM services WHERE shop_id = ? AND id = ?')
    .bind(shopId, id)
    .first<Service>();
  if (!service) throw new ApiError(400, 'Serviço inválido para este estabelecimento.');
  return service;
}
