import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import QRCode from 'qrcode';

const root = resolve(import.meta.dirname, '..');
const command = process.argv[2] || 'prepare';
const dir = resolve(root, command === 'test-local' ? 'work/pilot-test' : 'work/pilot');
mkdirSync(dir, { recursive: true, mode: 0o700 });
const template = JSON.parse(readFileSync(resolve(root, 'wrangler.pilot.json'), 'utf8'));
const marker = '00000000-0000-0000-0000-000000000002';
const localConfig = resolve(dir, 'wrangler.local.json');
const remoteConfig = resolve(dir, 'wrangler.remote.json');
const state = resolve(dir, 'state');
const seedFile = resolve(dir, 'seed.sql');
const secretsFile = resolve(dir, 'secrets.json');
const env = {
  ...process.env,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || resolve(root, 'work/config'),
  WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH || resolve(dir, 'wrangler.log'),
  WRANGLER_SEND_METRICS: 'false',
};
function save(path, data) {
  writeFileSync(path, data, { mode: 0o600 });
  chmodSync(path, 0o600);
}
function config(databaseId, accountId) {
  return {
    ...template,
    ...(accountId ? { account_id: accountId } : {}),
    main: resolve(root, template.main),
    assets: { ...template.assets, directory: resolve(root, template.assets.directory) },
    d1_databases: template.d1_databases.map((d) => ({
      ...d,
      database_id: databaseId,
      migrations_dir: resolve(root, d.migrations_dir),
    })),
  };
}
function guard(cfg, remote = false) {
  if (
    cfg.name !== 'tomazbarber-piloto' ||
    cfg.vars.APP_STAGE !== 'pilot' ||
    cfg.vars.WHATSAPP_MODE !== 'off' ||
    cfg.services?.length ||
    cfg.triggers?.crons?.length ||
    cfg.routes?.length ||
    cfg.queues ||
    cfg.workflows ||
    cfg.d1_databases.length !== 1 ||
    cfg.d1_databases[0].database_name !== 'tomazbarber-piloto'
  )
    throw new Error('Configuração não corresponde ao piloto isolado, sem integrações.');
  if (
    remote &&
    (cfg.d1_databases[0].database_id === marker ||
      !/^[a-f0-9-]{36}$/.test(cfg.d1_databases[0].database_id) ||
      !/^[a-f0-9]{32}$/.test(cfg.account_id))
  )
    throw new Error('Falta identificar a conta e o D1 remoto do piloto.');
}
function wrangler(args, capture = false) {
  return execFileSync(
    process.execPath,
    [resolve(root, 'node_modules/wrangler/bin/wrangler.js'), ...args],
    { cwd: root, env, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', encoding: 'utf8' },
  );
}
function prepare() {
  guard(template);
  if (!existsSync(secretsFile))
    save(
      secretsFile,
      JSON.stringify(
        {
          ADMIN_PASSWORDS: JSON.stringify({
            'tomaz-barber': randomBytes(24).toString('base64url'),
          }),
        },
        null,
        2,
      ),
    );
  const secrets = JSON.parse(readFileSync(secretsFile, 'utf8'));
  const passwords = JSON.parse(secrets.ADMIN_PASSWORDS);
  if (
    Object.keys(passwords).join(',') !== 'tomaz-barber' ||
    typeof passwords['tomaz-barber'] !== 'string' ||
    !/^[A-Za-z0-9_-]{20,200}$/.test(passwords['tomaz-barber']) ||
    Object.keys(secrets).join(',') !== 'ADMIN_PASSWORDS'
  )
    throw new Error('O piloto exige senha própria da TOMAZ e nenhum segredo Meta.');
  save(resolve(dir, '.dev.vars'), `ADMIN_PASSWORDS='${secrets.ADMIN_PASSWORDS}'\n`);
  save(localConfig, JSON.stringify(config(marker), null, 2));
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bahia' }).format(new Date());
  const past = new Date(Date.parse(`${today}T12:00:00-03:00`) - 86400000)
    .toISOString()
    .slice(0, 10);
  const start = Date.parse(`${past}T10:00:00-03:00`) / 1000;
  save(
    seedFile,
    `-- Apenas dados fictícios, somente TOMAZ. Não apaga nem redefine registros existentes.
INSERT INTO customers(shop_id,id,full_name,phone) VALUES ('tomaz-barber','piloto-cliente-joao','João Cliente Fictício','+5575999990801') ON CONFLICT(shop_id,id) DO NOTHING;
INSERT INTO customers(shop_id,id,full_name,phone) VALUES ('tomaz-barber','piloto-cliente-maria','Maria Cliente Fictícia','+5575999990802') ON CONFLICT(shop_id,id) DO NOTHING;
INSERT INTO appointments(id,shop_id,professional_id,customer_id,request_key,request_fingerprint,origin,customer_name,customer_phone,service_id,service_name,price_label,duration_minutes,starts_at,ends_at,booking_channel,schedule_revision)
SELECT '00000000-0000-4000-8000-00000000d101',s.shop_id,'principal','piloto-cliente-joao','piloto-historico-v1','seed-ficticio','hub','João Cliente Fictício','+5575999990801',s.id,s.name,s.price,s.duration,${start},${start}+s.duration*60,'hub',c.revision
FROM services s JOIN schedule_settings c ON c.shop_id=s.shop_id AND c.professional_id='principal' WHERE s.shop_id='tomaz-barber' AND s.id='corte'
AND NOT EXISTS(SELECT 1 FROM appointments WHERE shop_id='tomaz-barber' AND request_key='piloto-historico-v1');\n`,
  );
  console.log(
    'Piloto preparado. Credencial privada em work/pilot/secrets.json; nenhum segredo foi exibido.',
  );
}
function database(cfg, remote) {
  const path = remote ? remoteConfig : localConfig;
  guard(cfg, remote);
  const scope = remote ? ['--remote'] : ['--local', '--persist-to', state];
  wrangler(['d1', 'migrations', 'apply', 'tomazbarber-piloto', '--config', path, ...scope]);
  wrangler(['d1', 'execute', 'tomazbarber-piloto', '--config', path, ...scope, '--file', seedFile]);
}
async function links(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    !/^tomazbarber-piloto\.[a-z0-9-]+\.workers\.dev$/.test(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Use a origem HTTPS real do Worker tomazbarber-piloto em workers.dev.');
  const response = await fetch(`${url.origin}/api/services`);
  if (!response.ok || response.headers.get('X-Tomaz-Environment') !== 'pilot')
    throw new Error('Não foi possível confirmar o Worker de teste publicado.');
  const catalog = await response.json();
  if (catalog.shop.slug !== 'tomaz-barber' || catalog.features.phoneVerification !== false)
    throw new Error('Catálogo ou integração inesperada no piloto.');
  const result = {
    booking: `${url.origin}/s/tomaz-barber`,
    hub: `${url.origin}/s/tomaz-barber/hub`,
    qr: resolve(dir, 'qr-agendamento.png'),
    whatsapp: 'off',
  };
  await QRCode.toFile(result.qr, result.booking, {
    width: 1024,
    margin: 4,
    errorCorrectionLevel: 'M',
  });
  save(resolve(dir, 'links.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
try {
  if (command === 'links') await links(process.argv[3]);
  else {
    prepare();
    if (command === 'local' || command === 'test-local') {
      if (command === 'test-local') rmSync(state, { recursive: true, force: true });
      execFileSync('npm', ['run', 'build'], { cwd: root, env, stdio: 'inherit' });
      database(config(marker), false);
      wrangler([
        'dev',
        '--config',
        localConfig,
        '--ip',
        '127.0.0.1',
        '--port',
        '8789',
        '--persist-to',
        state,
      ]);
    } else if (command === 'deploy') {
      const account = env.CLOUDFLARE_ACCOUNT_ID;
      if (!/^[a-f0-9]{32}$/.test(account || ''))
        throw new Error(
          'BLOQUEADO antes de criar recursos: configure CLOUDFLARE_ACCOUNT_ID e autentique o Wrangler (login ou CLOUDFLARE_API_TOKEN privado). Veja docs/piloto-cloudflare.md.',
        );
      let list = JSON.parse(wrangler(['d1', 'list', '--json', '--config', localConfig], true));
      if (!list.some((d) => d.name === 'tomazbarber-piloto')) {
        wrangler([
          'd1',
          'create',
          'tomazbarber-piloto',
          '--config',
          localConfig,
          '--update-config=false',
        ]);
        list = JSON.parse(wrangler(['d1', 'list', '--json', '--config', localConfig], true));
      }
      const db = list.find((d) => d.name === 'tomazbarber-piloto');
      if (!db) throw new Error('O D1 de teste não foi localizado.');
      const cfg = config(db.uuid, account);
      guard(cfg, true);
      save(remoteConfig, JSON.stringify(cfg, null, 2));
      execFileSync('npm', ['run', 'build'], { cwd: root, env, stdio: 'inherit' });
      database(cfg, true);
      const output = wrangler(
        ['deploy', '--config', remoteConfig, '--secrets-file', secretsFile],
        true,
      );
      const url = output.match(/https:\/\/tomazbarber-piloto\.[a-z0-9-]+\.workers\.dev/g)?.at(-1);
      if (!url)
        throw new Error(
          'Deploy executado; confirme a URL no painel e execute pilot:links com ela.',
        );
      await links(url);
    } else if (command !== 'prepare')
      throw new Error('Comando desconhecido. Use prepare, local, deploy ou links.');
  }
} catch (error) {
  // Não imprimir stdout/stderr de um comando que possa conter material privado.
  console.error(
    error?.status
      ? 'O comando Cloudflare falhou. Confira autenticação/permissões e o log privado em work/pilot.'
      : error.message,
  );
  process.exitCode = 1;
}
