import { addDays, localDate, dateLabel, timeLabel, type Shop } from '../shared';
import { cancellationNotice, lateChangeNotice, type CustomerBooking } from '../customer';
import { reservationSummary } from './reservation-summary';
import { copyText } from './clipboard';
interface Options {
  id: string;
  shop: () => Shop;
  api: <T>(path: string, data?: unknown) => Promise<T>;
  shell: (html: string) => void;
  escape: (value: unknown) => string;
  publicPath: string;
}
export function createReservationAccess(o: Options) {
  const e = o.escape;
  let appointment: CustomerBooking | null = null,
    view: 'summary' | 'reschedule' | 'cancel' = 'summary';
  let loading = true,
    busy = false,
    error = '',
    notice = '',
    date = '',
    slots: number[] = [],
    target = 0,
    turn = 'Manhã',
    key = crypto.randomUUID(),
    epoch = 0;
  let privateUrl = location.hash ? location.href : '';
  const api = <T>(path = '', data?: unknown) =>
    o.api<T>(`/api/booking-access/${o.id}${path}`, data);
  const today = () => localDate(new Date(), o.shop().timezone),
    time = (s: number) => timeLabel(s, o.shop().timezone);
  const turns = [
    { name: 'Manhã', from: 0, to: 12 },
    { name: 'Tarde', from: 12, to: 18 },
    { name: 'Noite', from: 18, to: 24 },
  ];
  const inTurn = (s: number, name = turn) => {
    const t = turns.find((t) => t.name === name)!;
    const h = Number(time(s).slice(0, 2));
    return h >= t.from && h < t.to;
  };
  const info = (a: CustomerBooking) => reservationSummary(a, o.shop(), e);
  function render() {
    let content = '';
    if (loading && !appointment)
      content = '<p class="empty" role="status">Abrindo sua reserva…</p>';
    else if (!appointment)
      content = `<section class="customer-card"><h2>Abra seu link privado.</h2><p class="muted">Use o link completo salvo na confirmação. Informar nome ou telefone não libera a consulta.</p><a class="primary" href="${o.publicPath}">Voltar ao agendamento</a></section>`;
    else if (view === 'summary')
      content = `<section class="customer-card reservation-card">${info(appointment)}${appointment.status === 'confirmed' && appointment.startsAt * 1000 > Date.now() ? `<div class="my-booking-actions"><button class="text-button" data-private="reschedule">Remarcar</button><button class="text-button danger-text" data-private="cancel">${appointment.canCancel ? 'Cancelar' : 'Sobre cancelamento'}</button></div>` : ''}</section><section class="customer-policy"><h3>Se precisar mudar os planos</h3><p>${cancellationNotice}</p><p class="muted">Com menos de 2 horas, combine alterações diretamente com o salão. A taxa de falta de R$ 15,00 é tratada presencialmente.</p></section>${privateUrl ? '<button class="primary private-copy" data-private="copy">Copiar link privado desta reserva</button>' : ''}<p class="note">Guarde o link para voltar a este atendimento. Quem tiver o link poderá consultar e alterar somente esta reserva.</p><div class="private-bottom"><a class="text-button" href="${o.publicPath}">Fazer outra reserva</a><button class="text-button" data-private="logout">Fechar acesso</button></div>`;
    else if (view === 'reschedule')
      content = `<section class="customer-card reservation-card">${info(appointment)}<div class="current-slot"><strong>Seu horário atual continua reservado.</strong><p>Ele só será liberado depois da confirmação do novo.</p></div><h3>Escolha o novo horário</h3><label for="private-date">Nova data<input id="private-date" type="date" value="${date}" min="${today()}" max="${addDays(today(), 90)}" ${loading || busy ? 'disabled' : ''}></label>${
        loading
          ? '<p class="empty" role="status">Consultando horários…</p>'
          : slots.length
            ? `<nav class="my-turns" aria-label="Período do novo horário">${turns.map((t) => `<button data-private-turn="${t.name}" aria-pressed="${turn === t.name}" ${!slots.some((s) => inTurn(s, t.name)) ? 'disabled' : ''}>${t.name}</button>`).join('')}</nav><div class="times customer-times">${slots
                .filter((s) => inTurn(s))
                .map(
                  (s) =>
                    `<button class="time ${target === s ? 'selected' : ''}" data-private-time="${s}" aria-pressed="${target === s}">${time(s)}</button>`,
                )
                .join('')}</div>`
            : '<p class="empty">Nenhum horário livre nesta data. Escolha outra data.</p>'
      }${target ? `<div class="review my-new-slot"><h3>Confirme o novo horário</h3><p>${e(dateLabel(date, o.shop().timezone))}<strong>${time(target)}–${time(target + appointment.duration * 60)}</strong></p><p>Serviço, preço e duração continuam os mesmos.</p></div>` : ''}<div class="actions"><button class="text-button" data-private="back" ${busy ? 'disabled' : ''}>← Voltar</button><button class="primary" data-private="confirm-reschedule" ${busy || !target || loading ? 'disabled' : ''}>${busy ? 'Confirmando…' : 'Confirmar remarcação'}</button></div></section>`;
    else
      content = `<section class="customer-card reservation-card">${info(appointment)}<h3>${appointment.canCancel ? 'Cancelar este horário?' : 'Combine com o salão'}</h3><p>${cancellationNotice}</p>${appointment.canCancel ? '<p class="muted">Ao confirmar, seu horário será liberado. O registro da reserva será mantido.</p>' : `<p class="preserve-note">${lateChangeNotice}</p>`}<div class="actions"><button class="text-button" data-private="back" ${busy ? 'disabled' : ''}>Manter minha reserva</button>${appointment.canCancel ? `<button class="primary danger-button" data-private="confirm-cancel" ${busy ? 'disabled' : ''}>${busy ? 'Cancelando…' : 'Confirmar cancelamento'}</button>` : ''}</div></section>`;
    o.shell(
      `<div class="my-layout"><section class="my-heading"><span class="eyebrow">${e(o.shop().name)} / ACESSO PRIVADO</span><h1>Sua reserva</h1><p class="muted">Um atendimento. Seu tempo reservado.</p></section><div class="error" role="alert" ${error ? '' : 'hidden'}>${e(error)}</div>${notice ? `<p class="success-note" role="status">${e(notice)}</p>` : ''}${content}</div>`,
    );
  }
  function failed(cause: unknown) {
    error = cause instanceof Error ? cause.message : 'Não foi possível concluir. Tente novamente.';
    if ((cause as { status?: number })?.status === 401) {
      epoch++;
      appointment = null;
      slots = [];
      privateUrl = '';
    }
  }
  const focus = () => document.querySelector('main')?.scrollIntoView({ block: 'start' });
  async function refresh() {
    appointment = (await api<{ appointment: CustomerBooking }>()).appointment;
  }
  async function loadSlots() {
    const request = ++epoch;
    loading = true;
    slots = [];
    target = 0;
    render();
    try {
      const r = await api<{ slots: number[] }>(`/availability?date=${date}`);
      if (request === epoch) {
        slots = r.slots.filter((s) => s !== appointment!.startsAt);
        if (!slots.some((s) => inTurn(s)))
          turn = turns.find((t) => slots.some((s) => inTurn(s, t.name)))?.name || 'Manhã';
      }
    } catch (cause) {
      if (request === epoch) failed(cause);
    } finally {
      loading = false;
      render();
    }
  }
  async function mutate(kind: 'reschedule' | 'cancel') {
    busy = true;
    render();
    try {
      await api(`/${kind}`, {
        requestKey: key,
        expectedVersion: appointment!.version,
        ...(kind === 'reschedule' ? { startsAt: target } : {}),
      });
      await refresh();
      view = 'summary';
      notice =
        kind === 'reschedule'
          ? 'Novo horário confirmado. Sua reserva foi remarcada.'
          : 'Reserva cancelada sem custo. O registro foi preservado.';
      focus();
    } catch (cause) {
      failed(cause);
      if ((cause as { status?: number })?.status === 409 && appointment) {
        await refresh().catch(failed);
        key = crypto.randomUUID();
        if (appointment?.status === 'confirmed' && view === 'reschedule') await loadSlots();
        else view = 'summary';
      }
      if ((cause as { status?: number })?.status === 422 && appointment) {
        appointment.canCancel = false;
        appointment.canReschedule = false;
        view = 'cancel';
      }
    } finally {
      busy = false;
      render();
      if (error)
        document.querySelector('.error:not([hidden])')?.scrollIntoView({ block: 'center' });
    }
  }
  return {
    render,
    async start() {
      render();
      try {
        const token = new URLSearchParams(location.hash.slice(1)).get('acesso');
        if (token) {
          await api('/session', { token });
          history.replaceState(null, '', location.pathname + location.search);
        }
        await refresh();
      } catch (cause) {
        failed(cause);
      } finally {
        loading = false;
        render();
      }
    },
    async change(input: HTMLInputElement) {
      if (input.id === 'private-date' && input.value && !busy) {
        date = input.value;
        error = '';
        await loadSlots();
      }
    },
    async click(button: HTMLButtonElement) {
      if (busy || button.disabled) return;
      error = '';
      notice = '';
      if (button.dataset.privateTurn) {
        turn = button.dataset.privateTurn;
        target = 0;
        render();
        return;
      }
      if (button.dataset.privateTime) {
        target = Number(button.dataset.privateTime);
        key = crypto.randomUUID();
        render();
        document
          .querySelector<HTMLButtonElement>(`[data-private-time="${target}"]`)
          ?.focus({ preventScroll: true });
        return;
      }
      try {
        switch (button.dataset.private) {
          case 'copy':
            await copyText(privateUrl);
            notice = 'Link privado copiado. Guarde com cuidado.';
            render();
            break;
          case 'reschedule':
          case 'cancel':
            await refresh();
            key = crypto.randomUUID();
            view =
              button.dataset.private === 'reschedule' && appointment!.canReschedule
                ? 'reschedule'
                : 'cancel';
            date = localDate(new Date(appointment!.startsAt * 1000), o.shop().timezone);
            turn = turns.find((t) => inTurn(appointment!.startsAt, t.name))!.name;
            if (view === 'reschedule') await loadSlots();
            render();
            focus();
            break;
          case 'back':
            view = 'summary';
            await refresh();
            render();
            break;
          case 'confirm-reschedule':
            if (target) await mutate('reschedule');
            break;
          case 'confirm-cancel':
            if (appointment?.canCancel) await mutate('cancel');
            break;
          case 'logout':
            await api('/logout', {});
            appointment = null;
            privateUrl = '';
            notice = 'Acesso encerrado neste navegador. Use seu link para voltar.';
            render();
            break;
        }
      } catch (cause) {
        failed(cause);
        render();
      }
    },
  };
}
