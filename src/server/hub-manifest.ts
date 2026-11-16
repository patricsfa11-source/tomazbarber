import type { Shop } from '../shared';
export function hubManifest(shop: Shop) {
  const base = `/s/${shop.slug}`;
  const icon = shop.logoUrl ? 'tomaz-barber' : 'salao-aurora';
  return {
    id: `${base}/hub`,
    name: `${shop.name} · Hub`,
    short_name: shop.name,
    start_url: `${base}/hub`,
    scope: `${base}/`,
    display: 'standalone',
    lang: 'pt-BR',
    theme_color: '#121412',
    background_color: '#121412',
    description: `Agenda e clientes de ${shop.name}.`,
    icons: [
      { src: `/icons/${icon}-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `/icons/${icon}-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
