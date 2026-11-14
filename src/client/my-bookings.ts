import { addDays, localDate, dateLabel, timeLabel, type Shop } from '../shared';
import {
  cancellationNotice,
  lateChangeNotice,
  type CustomerBooking,
  type CustomerBookings,
} from '../customer';

interface Options {
  api: <T>(path: string, data?: unknown) => Promise<T>;
  shell: (html: string) => void;
  escape: (value: unknown) => string;
  shop: () => Shop;
  publicPath: string;
}
export function createMyBookings(o: Options) {
  const e = o.escape;
  let view: 'phone' | 'code' | 'list' | 'reschedule' | 'cancel' = 'phone';
  let phone = '',
    code = '',
    maskedPhone = '',
    challengeId = '',
    error = '',
    notice = '';
  let resendAt = 0,
    expiresAt = 0,
    busy = false,
    loading = false,
    epoch = 0;
  let appointments: CustomerBooking[] = [],
    current: CustomerBooking | null = null;
  let history = false,
    cursor: string | null = null,
    date = '',
    slots: number[] = [],
    target = 0;
  let actionKey = crypto.randomUUID();
  const turns = [
    { name: 'Manhã', from: 0, to: 12 },
    { name: 'Tarde', from: 12, to: 18 },
    { name: 'Noite', from: 18, to: 24 },
  ];
  let turn = 'Manhã';
  const needsLogin = () => view === 'phone';
  const today = () => localDate(new Date(), o.shop().timezone);
  const when = (a: CustomerBooking) =>
    `${dateLabel(localDate(new Date(a.startsAt * 1000), o.shop().timezone), o.shop().timezone)} · ${timeLabel(a.startsAt, o.shop().timezone)}–${timeLabel(a.endsAt, o.shop().timezone)}`;
  const time = (s: number) => timeLabel(s, o.shop().timezone);
  const inTurn = (s: number, name = turn) => {
    const range = turns.find((t) => t.name === name)!;
    const hour = Number(time(s).slice(0, 2));
    return hour >= range.from && hour < range.to;
  };
  function slotPicker() {
    return `<nav class="my-turns" aria-label="Período do novo horário">${turns.map((t) => `<button type="button" data-customer-turn="${t.name}" aria-pressed="${turn === t.name}" ${busy || !slots.some((s) => inTurn(s, t.name)) ? 'disabled' : ''}>${t.name}</button>`).join('')}</nav><div class="times customer-times" aria-label="Novos horários">${slots
      .filter((s) => inTurn(s))
      .map(
        (s) =>
          `<button type="button" class="time ${target === s ? 'selected' : ''}" data-customer-time="${s}" aria-pressed="${target === s}" ${busy ? 'disabled' : ''}>${time(s)}</button>`,
      )
      .join('')}</div>`;
  }
  const api = <T>(path: string, data?: unknown) => o.api<T>(`/api/customer${path}`, data);
  function clear() {
    epoch++;
    appointments = [];
    current = null;
    slots = [];
    target = 0;
    cursor = null;
  }
  function failure(cause: unknown) {
    error = cause instanceof Error ? cause.message : 'Não foi possível concluir. Tente novamente.';
    if ((cause as { status?: number })?.status === 401) {
      clear();
      view = 'phone';
      code = '';
      challengeId = '';
      maskedPhone = '';
    }
  }
  const bookingInfo = (a: CustomerBooking) =>
    `<div class="my-booking-summary"><span class="eyebrow">${a.status === 'cancelled' ? 'CANCELADO' : 'SEU HORÁRIO'}</span><h2>${e(a.service)}</h2><p class="my-when">${e(when(a))}</p><p>${e(a.price)}<br><span class="muted">${a.duration} minutos · Pagamento no atendimento</span></p></div>`;
  function render() {
    let content = '';
    if (view === 'phone')
      content = `<section class="customer-card verify-card"><span class="eyebrow">ACESSO PELO WHATSAPP</span><h2>Seus horários,<br>com você.</h2><p class="muted">Informe o celular usado na reserva. Vamos enviar um código para confirmar que o número é seu.</p><form id="customer-phone"><label for="customer-phone-input">Celular com DDD<input id="customer-phone-input" type="tel" autocomplete="tel" inputmode="tel" placeholder="(75) 99999-9999" value="${e(phone)}" maxlength="20" required></label><button class="primary" ${busy ? 'disabled' : ''}>${busy ? 'Enviando…' : 'Receber código pelo WhatsApp'} <span aria-hidden="true">→</span></button></form><p class="note">Sem senha ou cadastro adicional. O código vale por 5 minutos e dá acesso apenas aos seus horários neste estabelecimento.</p></section>`;
    if (view === 'code')
      content = `<section class="customer-card verify-card"><span class="eyebrow">CONFIRME SEU CELULAR</span><h2>Confira seu WhatsApp.</h2><p class="muted">Enviamos um código para <strong>${e(maskedPhone)}</strong>.</p><form id="customer-code"><label for="customer-code-input">Código de verificação<input id="customer-code-input" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" value="${e(code)}" placeholder="000000" required aria-describedby="code-help"></label><p id="code-help" class="note">Digite os seis dígitos. O código vale por 5 minutos. Não compartilhe com ninguém.</p><button class="primary" ${busy ? 'disabled' : ''}>${busy ? 'Verificando…' : 'Ver meus horários'} <span aria-hidden="true">→</span></button></form><div class="verification-actions"><button class="text-button" data-customer-action="resend" ${busy || Date.now() < resendAt ? 'disabled' : ''}>Reenviar código</button><button class="text-button" data-customer-action="change-phone" ${busy ? 'disabled' : ''}>Corrigir número</button></div><p class="note" data-resend-count>${Date.now() < resendAt ? `Você pode reenviar em ${Math.ceil((resendAt - Date.now()) / 1000)}s.` : Date.now() >= expiresAt ? 'Código expirado. Solicite um novo.' : 'Não recebeu? Confira o número ou solicite outro código.'}</p></section>`;
    if (view === 'list')
      content = `<div class="my-session"><span>Celular verificado<br><strong>${e(maskedPhone)}</strong></span><button class="text-button" data-customer-action="logout" ${busy ? 'disabled' : ''}>Sair</button></div><nav class="my-tabs" aria-label="Seus atendimentos"><button data-customer-action="upcoming" aria-pressed="${!history}">Próximos</button><button data-customer-action="history" aria-pressed="${history}">Histórico</button></nav>${loading ? '<p class="empty" role="status">Buscando seus horários…</p>' : appointments.length ? `<ul class="my-bookings">${appointments.map((a) => `<li class="customer-card">${bookingInfo(a)}${a.status === 'confirmed' && a.startsAt * 1000 > Date.now() ? `<div class="my-booking-actions"><button class="text-button" data-customer-reschedule="${e(a.id)}">Remarcar</button><button class="text-button danger-text" data-customer-cancel="${e(a.id)}">${a.canCancel ? 'Cancelar' : 'Sobre cancelamento'}</button></div>` : `<p class="status ${a.status === 'cancelled' ? 'cancelled' : ''}">${a.status === 'cancelled' ? 'Reserva cancelada' : 'Atendimento passado'}</p>`}</li>`).join('')}</ul>` : `<section class="customer-card my-empty"><span aria-hidden="true">◷</span><h2>${history ? 'Nenhum horário no histórico.' : 'Seu próximo cuidado começa aqui.'}</h2><p class="muted">${history ? 'Atendimentos passados e cancelados aparecem aqui.' : 'Não há reservas futuras para este celular em ' + e(o.shop().name) + '.'}</p><a class="primary" href="${o.publicPath}">Escolher um serviço <span aria-hidden="true">→</span></a></section>`}${cursor && !loading ? `<button class="text-button" data-customer-action="more" ${busy ? 'disabled' : ''}>Ver mais horários</button>` : ''}<div class="customer-policy"><h3>Se precisar mudar os planos</h3><p>${cancellationNotice}</p><p class="muted">Com menos de 2 horas, combine alterações diretamente com o salão. Taxa de falta de R$ 15,00 tratada presencialmente.</p></div>`;
    if (view === 'reschedule' && current)
      content = `<section class="customer-card">${bookingInfo(current)}<div class="current-slot"><strong>Seu horário atual está reservado.</strong><p>Ele só será liberado depois da confirmação do novo horário.</p></div><h3>Escolha o novo horário</h3><label for="customer-date">Nova data<input id="customer-date" type="date" value="${date}" min="${today()}" max="${addDays(today(), 90)}" ${busy || loading ? 'disabled' : ''} required></label>${
        loading
          ? '<p class="empty" role="status">Consultando horários…</p>'
          : slots.length
            ? slotPicker()
            : '<p class="empty">Nenhum horário livre nesta data. Escolha outra data.</p>'
      }${target ? `<div class="review my-new-slot"><h3>Confirme o novo horário</h3><p>${e(dateLabel(date, o.shop().timezone))}<strong>${time(target)}–${time(target + current.duration * 60)}</strong></p><p>O serviço, o preço e a duração continuam os mesmos.</p></div>` : ''}<div class="actions"><button class="text-button" data-customer-action="back" ${busy ? 'disabled' : ''}>← Voltar</button><button class="primary" data-customer-action="confirm-reschedule" ${!target || busy || loading ? 'disabled' : ''}>${busy ? 'Confirmando…' : 'Confirmar remarcação'}</button></div></section>`;
    if (view === 'cancel' && current)
      content = `<section class="customer-card">${bookingInfo(current)}<h3>${current.canCancel ? 'Cancelar este horário?' : 'Combine com o salão'}</h3><p>${cancellationNotice}</p>${current.canCancel ? '<p class="muted">Ao confirmar, seu horário ficará livre para outra pessoa. O registro será mantido no histórico.</p>' : `<p class="preserve-note">${lateChangeNotice}</p><p class="note">Não há cobrança automática. A taxa de falta é tratada presencialmente.</p>`}<div class="actions"><button class="text-button" data-customer-action="back" ${busy ? 'disabled' : ''}>Manter minha reserva</button>${current.canCancel ? `<button class="primary danger-button" data-customer-action="confirm-cancel" ${busy ? 'disabled' : ''}>${busy ? 'Cancelando…' : 'Confirmar cancelamento'}</button>` : ''}</div></section>`;
    o.shell(
      `<div class="my-layout"><section class="my-heading"><span class="eyebrow">${e(o.shop().name)}</span><h1>Meus horários</h1><p class="muted">Seu tempo reservado. Tudo por aqui.</p></section><div class="error" role="alert" ${error ? '' : 'hidden'}>${e(error)}</div>${notice ? `<p class="success-note" role="status">${e(notice)}</p>` : ''}${content}</div>`,
    );
  }
  function focus(selector = 'main h1') {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) {
      if (!element.matches('input')) element.tabIndex = -1;
      element.focus({ preventScroll: true });
    }
    document.querySelector('main')?.scrollIntoView({ block: 'start' });
  }
  async function list(more = false) {
    const request = ++epoch;
    view = 'list';
    loading = true;
    if (!more) {
      appointments = [];
      cursor = null;
    }
    render();
    try {
      const result = await api<CustomerBookings>(
        `/bookings?view=${history ? 'history' : 'upcoming'}${more && cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      if (request === epoch) {
        appointments = more ? [...appointments, ...result.appointments] : result.appointments;
        cursor = result.nextCursor;
      }
    } catch (cause) {
      if (request === epoch) failure(cause);
    } finally {
      if (request === epoch || needsLogin()) {
        loading = false;
        render();
      }
    }
  }
  async function loadSlots() {
    const request = ++epoch;
    loading = true;
    target = 0;
    slots = [];
    render();
    try {
      const result = await api<{ slots: number[] }>(
        `/bookings/${current!.id}/availability?date=${date}`,
      );
      if (request === epoch) {
        slots = result.slots.filter((s) => s !== current!.startsAt);
        if (!slots.some((s) => inTurn(s)))
          turn = turns.find((t) => slots.some((s) => inTurn(s, t.name)))?.name || 'Manhã';
      }
    } catch (cause) {
      if (request === epoch) failure(cause);
    } finally {
      if (request === epoch || needsLogin()) {
        loading = false;
        render();
      }
    }
  }
  async function send() {
    busy = true;
    code = '';
    render();
    try {
      const result = await api<{
        challengeId: string;
        maskedPhone: string;
        expiresAt: number;
        resendAfter: number;
      }>('/verification', { phone });
      challengeId = result.challengeId;
      maskedPhone = result.maskedPhone;
      expiresAt = result.expiresAt * 1000;
      resendAt = Date.now() + result.resendAfter * 1000;
      view = 'code';
    } catch (cause) {
      failure(cause);
    } finally {
      busy = false;
      render();
      focus(view === 'code' ? '#customer-code-input' : '#customer-phone-input');
    }
  }
  async function mutate(kind: 'reschedule' | 'cancel') {
    busy = true;
    render();
    try {
      await api(`/bookings/${current!.id}/${kind}`, {
        expectedVersion: current!.version,
        requestKey: actionKey,
        ...(kind === 'reschedule' ? { startsAt: target } : {}),
      });
      notice =
        kind === 'reschedule'
          ? 'Horário remarcado. Sua nova reserva está confirmada.'
          : 'Reserva cancelada sem custo. O registro está no seu histórico.';
      current = null;
      history = kind === 'cancel';
      await list();
      focus();
    } catch (cause) {
      failure(cause);
      if ((cause as { status?: number })?.status === 409 && current) {
        try {
          current = (await api<{ appointment: CustomerBooking }>(`/bookings/${current.id}`))
            .appointment;
        } catch (refreshError) {
          failure(refreshError);
        }
        actionKey = crypto.randomUUID();
        if (current?.status === 'confirmed' && view === 'reschedule') await loadSlots();
        else if (view !== 'phone') await list();
      }
      if ((cause as { status?: number })?.status === 422 && current) {
        current.canCancel = false;
        current.canReschedule = false;
        view = 'cancel';
      }
    } finally {
      busy = false;
      render();
      if (error)
        document.querySelector('.error:not([hidden])')?.scrollIntoView({ block: 'center' });
    }
  }
  // Atualiza só o contador: não substitui o formulário enquanto o cliente digita.
  setInterval(() => {
    if (view !== 'code') return;
    const button = document.querySelector<HTMLButtonElement>('[data-customer-action="resend"]');
    if (button) button.disabled = busy || Date.now() < resendAt;
    const caption = document.querySelector('[data-resend-count]');
    if (caption)
      caption.textContent =
        Date.now() < resendAt
          ? `Você pode reenviar em ${Math.ceil((resendAt - Date.now()) / 1000)}s.`
          : Date.now() >= expiresAt
            ? 'Código expirado. Solicite um novo.'
            : 'Não recebeu? Confira o número ou solicite outro código.';
  }, 1000);
  return {
    get busy() {
      return busy;
    },
    async start() {
      render();
      try {
        maskedPhone = (await api<{ maskedPhone: string }>('/session')).maskedPhone;
        await list();
      } catch (cause) {
        if ((cause as { status?: number })?.status !== 401) failure(cause);
        render();
      }
    },
    render,
    input(input: HTMLInputElement) {
      if (input.id === 'customer-phone-input') phone = input.value;
      if (input.id === 'customer-code-input') code = input.value;
    },
    async change(input: HTMLInputElement) {
      if (input.id === 'customer-date' && input.value) {
        date = input.value;
        error = '';
        await loadSlots();
      }
    },
    async submit(form: HTMLFormElement) {
      if (busy || !form.reportValidity()) return;
      error = '';
      notice = '';
      if (form.id === 'customer-phone') await send();
      if (form.id === 'customer-code') {
        busy = true;
        render();
        try {
          maskedPhone = (await api<{ maskedPhone: string }>('/verify', { challengeId, code }))
            .maskedPhone;
          code = '';
          challengeId = '';
          await list();
          focus();
        } catch (cause) {
          failure(cause);
        } finally {
          busy = false;
          render();
        }
      }
    },
    async click(button: HTMLButtonElement) {
      if (busy) return;
      error = '';
      notice = '';
      const id = button.dataset.customerReschedule || button.dataset.customerCancel;
      if (id) {
        busy = true;
        try {
          current = (await api<{ appointment: CustomerBooking }>(`/bookings/${id}`)).appointment;
          actionKey = crypto.randomUUID();
          view =
            button.dataset.customerReschedule && current.canReschedule ? 'reschedule' : 'cancel';
          date = localDate(new Date(current.startsAt * 1000), o.shop().timezone);
          turn = turns.find((t) => inTurn(current!.startsAt, t.name))!.name;
          if (view === 'reschedule') await loadSlots();
          else render();
          focus();
        } catch (cause) {
          failure(cause);
        } finally {
          busy = false;
          render();
        }
        return;
      }
      if (button.dataset.customerTime) {
        target = Number(button.dataset.customerTime);
        actionKey = crypto.randomUUID();
        render();
        document
          .querySelector<HTMLButtonElement>(`[data-customer-time="${target}"]`)
          ?.focus({ preventScroll: true });
        return;
      }
      if (button.dataset.customerTurn) {
        turn = button.dataset.customerTurn;
        target = 0;
        render();
        return;
      }
      switch (button.dataset.customerAction) {
        case 'resend':
          if (Date.now() >= resendAt) await send();
          break;
        case 'change-phone':
          view = 'phone';
          code = '';
          challengeId = '';
          render();
          focus('#customer-phone-input');
          break;
        case 'logout':
          busy = true;
          try {
            await api('/logout', {});
            clear();
            view = 'phone';
            phone = '';
            maskedPhone = '';
          } catch (cause) {
            failure(cause);
          } finally {
            busy = false;
            render();
          }
          break;
        case 'history':
          history = true;
          await list();
          break;
        case 'upcoming':
          history = false;
          await list();
          break;
        case 'more':
          await list(true);
          break;
        case 'back':
          current = null;
          await list();
          break;
        case 'confirm-reschedule':
          if (target && current) await mutate('reschedule');
          break;
        case 'confirm-cancel':
          if (current?.canCancel) await mutate('cancel');
          break;
      }
    },
  };
}
