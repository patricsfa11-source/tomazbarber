// Remetente de teste. Este Worker não integra a configuração normal da aplicação.
// Não publicar: mensagens e códigos fictícios ficam somente na memória do teste.
interface Message {
  challengeId: string;
  shopId: string;
  shopName: string;
  phone: string;
  code: string;
  expiresAt: number;
}
const messages = new Map<string, Message>();
const metaMessages: {
  payload: Record<string, unknown>;
  providerId: string | null;
  status: number;
}[] = [];
let nextStatus = 200;
export default {
  async fetch(request: Request, env: { TEST_KEY: string }) {
    const url = new URL(request.url);
    if (/^\/v\d+\.\d+\/111111111111\/messages$/.test(url.pathname) && request.method === 'POST') {
      if (request.headers.get('Authorization') !== 'Bearer token-ficticio-exclusivo-e2e')
        return Response.json({ error: { code: 190 } }, { status: 401 });
      const payload = await request.json<Record<string, unknown>>(),
        status = nextStatus;
      nextStatus = 200;
      const providerId = status === 200 ? `wamid.${crypto.randomUUID()}` : null;
      metaMessages.push({ payload, providerId, status });
      return status === 200
        ? Response.json({ messages: [{ id: providerId }] })
        : Response.json({ error: { code: status === 429 ? 130429 : 132001 } }, { status });
    }
    if (url.pathname === '/send' && request.method === 'POST') {
      const message = await request.json<Message>();
      if (!message.challengeId || !/^\d{6}$/.test(message.code))
        return new Response('Invalid', { status: 400 });
      messages.set(message.challengeId, message);
      return Response.json({ accepted: true });
    }
    if (!['localhost', '127.0.0.1'].includes(url.hostname))
      return new Response('Not found', { status: 404 });
    if (url.pathname === '/health') return Response.json({ ok: true });
    if (request.headers.get('Authorization') !== `Bearer ${env.TEST_KEY}`)
      return new Response('Unauthorized', { status: 401 });
    if (url.pathname === '/meta-messages')
      return Response.json(metaMessages, { headers: { 'Cache-Control': 'no-store' } });
    if (url.pathname === '/meta-control' && request.method === 'POST') {
      const d = await request.json<{ status: number }>();
      nextStatus = d.status;
      return Response.json({ ok: true });
    }
    const message = messages.get(url.searchParams.get('challengeId') || '');
    return message
      ? Response.json(message, { headers: { 'Cache-Control': 'no-store' } })
      : new Response('Not found', { status: 404 });
  },
};
