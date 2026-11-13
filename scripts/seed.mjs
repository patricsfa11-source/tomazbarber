import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

// Apenas D1 local; não aceita destino remoto nem dados reais.
let date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bahia' }).format(
  new Date(Date.now() + 86400000),
);
while (new Date(`${date}T12:00:00-03:00`).getUTCDay() === 0)
  date = new Date(Date.parse(`${date}T12:00:00-03:00`) + 86400000).toISOString().slice(0, 10);
const start = Date.parse(`${date}T09:00:00-03:00`) / 1000;
mkdirSync('work', { recursive: true });
writeFileSync(
  'work/seed.sql',
  `INSERT INTO appointments
  (id,request_key,request_fingerprint,origin,customer_name,customer_phone,service_id,service_name,price_label,duration_minutes,starts_at,ends_at)
  SELECT 'demo-joao','demo-seed','seed-ficticio','hub','João Exemplo','+5575999990000','corte-barba','Corte com barba','R$ 38,00',40,${start},${start + 2400}
  WHERE NOT EXISTS (SELECT 1 FROM appointments WHERE id = 'demo-joao')
    AND NOT EXISTS (SELECT 1 FROM appointments WHERE starts_at < ${start + 2400} AND ends_at > ${start});`,
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
  `Dados fictícios preparados. Consulte a agenda de ${date}. O comando pode ser repetido sem duplicar o exemplo.`,
);
