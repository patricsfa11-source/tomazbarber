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
export default {
  async fetch(request: Request, env: { TEST_KEY: string }) {
    const url = new URL(request.url);
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
    const message = messages.get(url.searchParams.get('challengeId') || '');
    return message
      ? Response.json(message, { headers: { 'Cache-Control': 'no-store' } })
      : new Response('Not found', { status: 404 });
  },
};
