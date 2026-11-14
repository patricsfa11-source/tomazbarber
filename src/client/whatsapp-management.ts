import type { WhatsAppStatus } from '../whatsapp';
interface Options {
  api: <T>(path: string, data?: unknown) => Promise<T>;
  shell: (html: string) => void;
  tabs: () => string;
  escape: (text: unknown) => string;
  onError: (error: unknown) => void;
  render: () => void;
  open: () => void;
}
const labels: Record<string, string> = {
  queued: 'Aguardando envio',
  sending: 'Enviando',
  accepted: 'Aceita pela Meta',
  sent: 'Enviada',
  delivered: 'Entregue',
  read: 'Lida',
  retry: 'Nova tentativa programada',
  failed: 'Falha identificada',
  unknown: 'Resultado incerto — conferir',
  suppressed: 'Envio suprimido',
  expired: 'Prazo encerrado',
};
const kinds: Record<string, string> = {
  access_code: 'Código de acesso',
  confirmation: 'Confirmação da reserva',
  reschedule: 'Confirmação da remarcação',
  cancellation: 'Confirmação do cancelamento',
  reminder: 'Lembrete de atendimento',
  test: 'Mensagem de teste',
};
export function createWhatsAppManagement(o: Options) {
  let status: WhatsAppStatus | null = null,
    loading = false,
    busy = false,
    error = '',
    notice = '',
    confirm = false,
    epoch = 0,
    key = crypto.randomUUID();
  const e = o.escape;
  function render() {
    o.shell(
      `<section class="hub-heading settings-heading"><div><h1>WhatsApp</h1><p class="muted">Acompanhe as mensagens da sua agenda.</p></div></section>${o.tabs()}<section class="settings-content wa-content"><div class="error" role="alert" ${error ? '' : 'hidden'}>${e(error)}</div>${notice ? `<p class="success-note" role="status">${e(notice)}</p>` : ''}${loading ? '<p class="empty" role="status">Consultando envios…</p>' : status ? `<section class="settings-card"><span class="eyebrow">${status.configured ? 'TESTE CONTROLADO' : 'EM PREPARAÇÃO'}</span><h2>${status.configured ? 'Vamos conferir a conexão?' : 'Envios para clientes desativados.'}</h2><p class="muted">${status.configured ? `Nesta etapa, as mensagens vão somente para ${e(status.testRecipient)}. Os clientes não recebem envios.` : 'As reservas continuam funcionando. A integração aguarda configuração e revisão antes de enviar mensagens.'}</p>${status.configured ? (confirm ? `<div class="preserve-note">Enviar uma mensagem de teste para ${e(status.testRecipient)}?</div><div class="actions"><button class="text-button" data-wa="back" ${busy ? 'disabled' : ''}>Voltar</button><button class="primary" data-wa="send-test" ${busy ? 'disabled' : ''}>${busy ? 'Enviando…' : 'Enviar teste'}</button></div>` : `<button class="primary" data-wa="confirm-test" ${busy ? 'disabled' : ''}>Conferir destinatário</button>`) : ''}</section><div class="wa-list-heading"><h2>Últimos envios</h2><button class="text-button" data-wa="refresh" ${busy ? 'disabled' : ''}>Atualizar ↻</button></div><p class="note">Aceita pela Meta não significa entregue. A confirmação de entrega aparece quando o WhatsApp informa o resultado.</p>${status.deliveries.length ? `<ul class="wa-deliveries">${status.deliveries.map((d) => `<li class="settings-card"><span class="eyebrow">${e(kinds[d.kind] || d.kind)}</span><h3>${e(labels[d.state] || d.state)}</h3><p class="muted">Referência ${e(d.id.slice(0, 8).toUpperCase())} · ${d.attempts} tentativa(s)</p>${d.state === 'unknown' ? '<p class="preserve-note">Não vamos repetir um envio que pode ter sido aceito. Confira o resultado antes de qualquer nova mensagem.</p>' : ''}${d.state === 'retry' ? '<p class="note">A mensagem será tentada novamente, respeitando seu prazo e a situação atual da reserva.</p>' : ''}${d.last_error_code ? `<p class="note">Código de retorno: ${e(d.last_error_code)}</p>` : ''}${d.canRetry ? `<button class="text-button" data-wa-retry="${e(d.id)}" ${busy ? 'disabled' : ''}>Tentar novamente</button>` : ''}</li>`).join('')}</ul>` : '<p class="empty">Nenhum envio registrado neste estabelecimento.</p>'}` : ''}</section>`,
    );
  }
  async function load() {
    const request = ++epoch;
    loading = true;
    o.render();
    try {
      const result = await o.api<WhatsAppStatus>('/api/admin/whatsapp');
      if (request === epoch) status = result;
    } catch (cause) {
      if (request === epoch) {
        error = cause instanceof Error ? cause.message : 'Tente novamente.';
        o.onError(cause);
      }
    } finally {
      if (request === epoch) {
        loading = false;
        o.render();
      }
    }
  }
  return {
    render,
    get busy() {
      return busy;
    },
    close() {
      epoch++;
      status = null;
      error = '';
      notice = '';
      confirm = false;
    },
    async open() {
      o.open();
      status = null;
      error = '';
      notice = '';
      await load();
    },
    async click(button: HTMLButtonElement) {
      if (!button.dataset.wa && !button.dataset.waRetry) return false;
      if (busy) return true;
      error = '';
      notice = '';
      if (button.dataset.wa === 'confirm-test') {
        confirm = true;
        key = crypto.randomUUID();
        o.render();
        return true;
      }
      if (button.dataset.wa === 'back') {
        confirm = false;
        o.render();
        return true;
      }
      if (button.dataset.wa === 'refresh') {
        await load();
        return true;
      }
      busy = true;
      o.render();
      try {
        if (button.dataset.wa === 'send-test') {
          await o.api('/api/admin/whatsapp/test', { requestKey: key });
          confirm = false;
          notice = 'Teste registrado. Confira o estado do envio e o WhatsApp do destinatário.';
        } else
          await o.api(`/api/admin/whatsapp/${button.dataset.waRetry}/retry`, {
            requestKey: crypto.randomUUID(),
          });
        await load();
      } catch (cause) {
        error = cause instanceof Error ? cause.message : 'Tente novamente.';
        o.onError(cause);
      } finally {
        busy = false;
        o.render();
      }
      return true;
    },
  };
}
