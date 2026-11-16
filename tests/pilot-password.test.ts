import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import worker from '../src/server';

it.each([
  ['pilot', '87654321', 200],
  ['pilot', '8765432', 503],
  ['development', '87654321', 503],
])('respeita o tamanho mínimo da senha em %s', async (stage, password, status) => {
  const request = new Request('https://tomaz.test/api/shops/tomaz-barber/admin/login', {
    method: 'POST',
    headers: { Origin: 'https://tomaz.test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const response = await worker.fetch(request, {
    ...env,
    APP_STAGE: stage,
    ADMIN_PASSWORDS: JSON.stringify({ 'tomaz-barber': password }),
  });
  expect(response.status).toBe(status);
  if (status === 200) expect(response.headers.get('set-cookie')).toContain('HttpOnly');
});
