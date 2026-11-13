import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

// Somente D1 local, dados fictícios. As duas unidades usam a mesma data e telefone.
let date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bahia' }).format(
  new Date(Date.now() + 86400000),
);
while ([0, 1].includes(new Date(`${date}T12:00:00-03:00`).getUTCDay()))
  date = new Date(Date.parse(`${date}T12:00:00-03:00`) + 86400000).toISOString().slice(0, 10);
const start = Date.parse(`${date}T09:00:00-03:00`) / 1000;
const examples = [
  {
    shop: 'tomaz-barber',
    id: 'demo-tomaz',
    name: 'João Exemplo',
    service: 'corte-barba',
    title: 'Corte com barba',
    price: 'R$ 38,00',
    duration: 40,
  },
  {
    shop: 'salao-aurora',
    id: 'demo-aurora',
    name: 'Maria Exemplo',
    service: 'corte',
    title: 'Corte e finalização',
    price: 'R$ 55,00',
    duration: 60,
  },
];
mkdirSync('work', { recursive: true });
writeFileSync(
  'work/seed.sql',
  readFileSync(new URL('../fixtures/0001_salao_aurora.sql', import.meta.url), 'utf8') +
    '\n' +
    examples
      .map(
        (x) => `
INSERT INTO customers (shop_id,id,full_name,phone) VALUES ('${x.shop}','${x.id}-cliente','${x.name}','+5575999990000') ON CONFLICT(shop_id,phone) DO NOTHING;
INSERT INTO appointments (id,shop_id,professional_id,customer_id,request_key,request_fingerprint,origin,customer_name,customer_phone,service_id,service_name,price_label,duration_minutes,starts_at,ends_at)
SELECT '${x.id}','${x.shop}','principal',c.id,'demo-seed','seed-ficticio','hub','${x.name}','+5575999990000','${x.service}','${x.title}','${x.price}',${x.duration},${start},${start + x.duration * 60}
FROM customers c WHERE c.shop_id='${x.shop}' AND c.phone='+5575999990000'
AND NOT EXISTS(SELECT 1 FROM appointments WHERE shop_id='${x.shop}' AND request_key='demo-seed')
AND NOT EXISTS(SELECT 1 FROM appointments WHERE shop_id='${x.shop}' AND professional_id='principal' AND starts_at < ${start + x.duration * 60} AND ends_at > ${start});`,
      )
      .join('\n'),
);
execFileSync(
  'node',
  [
    'node_modules/wrangler/bin/wrangler.js',
    'd1',
    'execute',
    'tomazbarber-dev',
    '--local',
    '--file',
    'work/seed.sql',
  ],
  { stdio: 'inherit' },
);
console.log(
  `Dados fictícios dos dois estabelecimentos preparados para ${date}. O seed pode ser repetido sem duplicar reservas.`,
);
