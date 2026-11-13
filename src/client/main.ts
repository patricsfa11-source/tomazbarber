import './style.css';
import { addDays, dateLabel, localDate, timeLabel, timezone, type Service } from '../shared';

const app = document.querySelector<HTMLDivElement>('#app')!;
const isHub = location.pathname.replace(/\/$/, '') === '/hub';
const state = {
  services: [] as Service[],
  serviceId: 'corte',
  date: localDate(),
  slots: [] as number[],
  startsAt: 0,
  step: 1,
  name: '',
  phone: '',
  key: crypto.randomUUID() as string,
  error: '',
  loading: false,
  busy: false,
  loggedIn: false,
  booking: false,
  appointments: [] as AgendaItem[],
  receipt: undefined as Receipt | undefined,
};
interface Receipt {
  id: string;
  service: string;
  price: string;
  duration: number;
  startsAt: number;
  endsAt: number;
}
interface AgendaItem {
  id: string;
  customer_name: string;
  customer_phone: string;
  service_name: string;
  price_label: string;
  starts_at: number;
  ends_at: number;
  origin: string;
}
class RequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
const selected = () => state.services.find((s) => s.id === state.serviceId)!;
async function api<T>(path: string, data?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: data === undefined ? {} : { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new RequestError(
      response.status,
      result.error || 'Não foi possível carregar. Tente novamente.',
    );
  return result;
}
const bookingBase = () => (isHub ? '/api/admin' : '/api');
function brand(): string {
  // Marca tipográfica provisória. Substituir pela logo original ao receber o arquivo.
  return '<a class="brand" href="/" aria-label="TOMAZ BARBER, início"><span>TOMAZ<span class="brand-dot">.</span></span><small>BARBER</small></a>';
}
function shell(content: string): void {
  app.innerHTML = `<div class="demo-bar">AMBIENTE DE TESTE <span>·</span> Utilize apenas dados fictícios</div>
    <header>${brand()}<nav aria-label="Navegação principal"><a href="/" ${!isHub ? 'aria-current="page"' : ''}>Agendar</a><a href="/hub" ${isHub ? 'aria-current="page"' : ''}>Hub do barbeiro <span aria-hidden="true">→</span></a></nav></header>
    <main>${content}</main><footer><span>TOMAZ BARBER</span><p>Segunda a sábado · 7h30 às 20h<br>Horário da Bahia</p><small>Feito para cuidar do seu tempo.</small></footer>`;
}
const errorBox = () =>
  `<div class="error" role="alert" ${state.error ? '' : 'hidden'}>${escape(state.error)}</div>`;
function steps(): string {
  return `<ol class="steps" aria-label="Etapas da reserva">${['Serviço', 'Dia e horário', 'Seus dados'].map((label, i) => `<li class="${state.step === i + 1 ? 'current' : state.step > i + 1 ? 'done' : ''}" ${state.step === i + 1 ? 'aria-current="step"' : ''}><span>${state.step > i + 1 ? '✓' : `0${i + 1}`}</span>${label}</li>`).join('')}</ol>`;
}
function summary(): string {
  const service = selected();
  return `<aside class="summary"><span class="eyebrow">SEU AGENDAMENTO</span><h3>${escape(service.name)}</h3><p class="price">${escape(service.price)}</p><div class="summary-line"><span>Duração</span><strong>${service.duration} minutos</strong></div>${state.step > 1 ? `<div class="summary-line"><span>Data</span><strong>${escape(dateLabel(state.date))}</strong></div>` : ''}${state.startsAt ? `<div class="summary-line"><span>Horário</span><strong>${timeLabel(state.startsAt)} — ${timeLabel(state.startsAt + service.duration * 60)}</strong></div>` : ''}<p class="note">O pagamento é feito no atendimento.</p><div class="care"><span aria-hidden="true">◷</span><p>Um tempo reservado<br>para você.</p></div></aside>`;
}
function serviceView(): string {
  return `<div class="section-heading"><div><span class="eyebrow">01 / ESCOLHA O SERVIÇO</span><h2>Como vamos cuidar<br>do seu visual?</h2></div><span class="muted">${state.services.length} serviços</span></div>
    <div class="services" role="radiogroup" aria-label="Serviço">${state.services.map((s, i) => `<button type="button" class="service ${state.serviceId === s.id ? 'selected' : ''}" role="radio" tabindex="${state.serviceId === s.id ? 0 : -1}" aria-checked="${state.serviceId === s.id}" data-service="${s.id}"><span class="service-top"><span class="service-number">0${i + 1}</span><span class="radio" aria-hidden="true"></span></span><strong>${escape(s.name)}</strong><span class="description">${escape(s.description)}</span><span class="service-bottom"><span>${escape(s.price)}</span><small>${s.duration} min</small></span></button>`).join('')}</div>
    <div class="actions"><p class="muted">Preço e duração sem surpresa.</p><button class="primary" data-action="next">Escolher horário <span aria-hidden="true">→</span></button></div>`;
}
function datesView(): string {
  const today = localDate();
  const dates = Array.from({ length: 7 }, (_, i) =>
    addDays(state.date < addDays(today, 7) ? today : state.date, i),
  );
  const turns = [
    { name: 'Manhã', start: 0, end: 12 },
    { name: 'Tarde', start: 12, end: 18 },
    { name: 'Noite', start: 18, end: 24 },
  ];
  return `<div class="section-heading"><div><span class="eyebrow">02 / DIA E HORÁRIO</span><h2>Escolha seu momento.</h2></div></div>
    <div class="date-tools"><label for="date">Data do atendimento</label><input id="date" type="date" min="${today}" max="${addDays(today, 90)}" value="${state.date}" ${state.loading ? 'disabled' : ''}></div>
    <div class="dates" aria-label="Próximos dias">${dates
      .map((date) => {
        const d = new Date(`${date}T12:00:00-03:00`);
        return `<button type="button" data-date="${date}" class="date ${state.date === date ? 'selected' : ''}" aria-pressed="${state.date === date}" ${state.loading ? 'disabled' : ''}><small>${new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: timezone }).format(d).replace('.', '')}</small><strong>${d.getUTCDate()}</strong><small>${new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: timezone }).format(d).replace('.', '')}</small></button>`;
      })
      .join('')}</div>
    <p class="date-caption">${escape(dateLabel(state.date))} <span>· Horário da Bahia</span></p>
    <div aria-live="polite" aria-busy="${state.loading}">${
      state.loading
        ? '<p class="empty">Consultando horários…</p>'
        : state.slots.length
          ? turns
              .map((turn) => {
                const slots = state.slots.filter((s) => {
                  const hour = Number(timeLabel(s).slice(0, 2));
                  return hour >= turn.start && hour < turn.end;
                });
                return slots.length
                  ? `<section class="turn"><h3>${turn.name} <span>${slots.length} horários</span></h3><div class="times">${slots.map((start) => `<button type="button" data-time="${start}" class="time ${state.startsAt === start ? 'selected' : ''}" aria-pressed="${state.startsAt === start}">${timeLabel(start)}</button>`).join('')}</div></section>`
                  : '';
              })
              .join('')
          : `<div class="empty"><strong>Nenhum horário disponível.</strong><p>${new Date(`${state.date}T12:00:00-03:00`).getUTCDay() === 0 ? 'Domingo é nosso dia de pausa.' : 'Os horários deste dia já passaram ou estão ocupados.'} Escolha outra data.</p></div>`
    }</div>
    <div class="actions"><button class="text-button" data-action="back">← Voltar</button><button class="primary" data-action="next" ${!state.startsAt || state.loading ? 'disabled' : ''}>Continuar <span aria-hidden="true">→</span></button></div>`;
}
function detailsView(): string {
  return `<span class="eyebrow">03 / REVISE E CONFIRME</span><h2>Quase tudo pronto.</h2><p class="muted">${isHub ? 'Informe os dados do cliente para registrar o encaixe.' : 'Só precisamos de dois dados para reservar seu horário.'}</p>
    <form id="booking-form"><div class="fields"><label for="name">Nome completo<input id="name" name="name" autocomplete="name" required minlength="5" maxlength="100" value="${escape(state.name)}" placeholder="Ex.: João da Silva"></label><label for="phone">Celular com DDD<input id="phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" required maxlength="20" value="${escape(state.phone)}" placeholder="(75) 99999-9999"></label></div>
    <div class="review"><h3>Confira sua reserva</h3><p><strong>${escape(selected().name)}</strong><span>${escape(selected().price)}</span></p><p>${escape(dateLabel(state.date))}<strong>${timeLabel(state.startsAt)} · ${selected().duration} min</strong></p></div>
    <div class="rules"><h3>Para o seu atendimento</h3><ul><li>Chegue 10 minutos antes. A tolerância é de 10 minutos após o início.</li><li>Cancelamento sem custo com pelo menos 2 horas de antecedência.</li><li>Em caso de falta, taxa de R$ 15,00 tratada presencialmente.</li></ul><p>Neste teste, a confirmação aparece aqui na tela. WhatsApp e alterações da reserva serão disponibilizados em uma próxima etapa.</p></div>
    <div class="actions"><button type="button" class="text-button" data-action="back" ${state.busy ? 'disabled' : ''}>← Voltar</button><button type="submit" class="primary" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Confirmando…' : isHub ? 'Confirmar encaixe' : 'Confirmar reserva'} <span aria-hidden="true">✓</span></button></div></form>`;
}
function confirmation(): string {
  const r = state.receipt!;
  return `<section class="confirmation"><span class="success-mark" aria-hidden="true">✓</span><span class="eyebrow">HORÁRIO GARANTIDO</span><h1>${isHub ? 'Encaixe confirmado.' : 'Nos vemos em breve.'}</h1><p>Seu horário está reservado na TOMAZ BARBER.</p><div class="confirmed-details"><span>${escape(dateLabel(localDate(new Date(r.startsAt * 1000))))}</span><strong>${timeLabel(r.startsAt)}</strong><h2>${escape(r.service)}</h2><p>${escape(r.price)} · ${r.duration} minutos</p><small>Reserva ${escape(r.id.slice(0, 8).toUpperCase())}</small></div><p class="muted">Chegue 10 minutos antes do horário.<br>Nenhuma mensagem de WhatsApp é enviada neste teste.</p><button class="primary" data-action="restart">${isHub ? 'Voltar à agenda' : 'Fazer outra reserva'} <span aria-hidden="true">→</span></button></section>`;
}
function renderBooking(): void {
  if (state.receipt) {
    shell(confirmation());
    return;
  }
  shell(
    `<section class="intro"><span class="eyebrow">${isHub ? 'HUB / NOVO ENCAIXE' : 'SEU ESTILO. SEU TEMPO.'}</span><h1>${isHub ? 'Um lugar na agenda.' : 'Seu próximo corte<br>começa aqui<span>.</span>'}</h1><p>${isHub ? 'A mesma agenda, para quem chega pelo link ou pela porta.' : 'Escolha o serviço, encontre o melhor horário e deixe o resto com a gente.'}</p></section>${steps()}<div class="booking-layout"><section class="booking-content">${errorBox()}${state.step === 1 ? serviceView() : state.step === 2 ? datesView() : detailsView()}${isHub ? '<button class="text-button close-booking" data-action="agenda">Voltar à agenda do hub</button>' : ''}</section>${summary()}</div>`,
  );
}
function renderLogin(): void {
  shell(
    `<section class="login"><span class="eyebrow">ÁREA DO BARBEIRO</span><h1>Sua agenda,<br>em um só lugar<span>.</span></h1><p class="muted">Entre para acompanhar os horários e registrar encaixes.</p>${errorBox()}<form id="login-form"><label for="password">Senha do hub<input id="password" type="password" autocomplete="current-password" required maxlength="200"></label><button class="primary" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Entrando…' : 'Entrar no hub'} <span aria-hidden="true">→</span></button></form><p class="note">Acesso restrito · Ambiente de testes</p></section>`,
  );
}
function renderAgenda(): void {
  const today = localDate();
  shell(`<section class="hub-heading"><div><span class="eyebrow">HUB / AGENDA DIÁRIA</span><h1>O dia começa aqui<span>.</span></h1><p class="muted">Reservas pelo link e encaixes, na mesma agenda.</p></div><button class="text-button" data-action="logout">Sair do hub →</button></section>
    <section class="agenda"><div class="agenda-toolbar"><div><label for="agenda-date">Data da agenda</label><input type="date" id="agenda-date" value="${state.date}" min="${today}" max="${addDays(today, 90)}"></div><button class="primary" data-action="new">+ Novo encaixe</button></div><div class="agenda-day"><h2>${escape(dateLabel(state.date))}</h2><div><span>${state.appointments.length} atendimento${state.appointments.length !== 1 ? 's' : ''}</span><button class="text-button" data-action="refresh">Atualizar ↻</button></div></div>${errorBox()}
    <div aria-live="polite">${state.loading ? '<p class="empty">Carregando agenda…</p>' : state.appointments.length ? `<ol class="appointments">${state.appointments.map((a) => `<li><div class="appointment-time"><strong>${timeLabel(a.starts_at)}</strong><span>${timeLabel(a.ends_at)}</span></div><div class="appointment-info"><span class="tag">${a.origin === 'hub' ? 'ENCAIXE / HUB' : 'RESERVA / LINK'}</span><h3>${escape(a.customer_name)}</h3><p>${escape(a.service_name)} · ${escape(a.price_label)}</p><a href="tel:${escape(a.customer_phone)}">${escape(a.customer_phone)}</a></div><span class="status">Confirmado</span></li>`).join('')}</ol>` : '<div class="empty"><span class="empty-icon" aria-hidden="true">◷</span><h3>Um dia cheio de possibilidades.</h3><p>Nenhum atendimento nesta data. Os agendamentos aparecem aqui assim que são confirmados.</p></div>'}</div><p class="note">Horário da Bahia · Atualize a agenda para consultar novas reservas.</p></section>`);
}
function render(): void {
  if (!isHub || state.booking) renderBooking();
  else if (!state.loggedIn) renderLogin();
  else renderAgenda();
}
function focusStage(): void {
  const target =
    document.querySelector<HTMLElement>('.booking-content h2') ??
    document.querySelector<HTMLElement>('main h1');
  if (target) {
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
  }
  document.querySelector('.steps, main')?.scrollIntoView({ block: 'start' });
}
let slotRequest = 0;
async function loadSlots(): Promise<void> {
  const request = ++slotRequest;
  state.loading = true;
  state.startsAt = 0;
  state.slots = [];
  render();
  try {
    const result = await api<{ slots: number[] }>(
      `${bookingBase()}/availability?date=${state.date}&serviceId=${state.serviceId}`,
    );
    if (request === slotRequest) state.slots = result.slots;
  } catch (error) {
    if (request === slotRequest) handleError(error);
  } finally {
    if (request === slotRequest) {
      state.loading = false;
      render();
    }
  }
}
let agendaRequest = 0;
async function loadAgenda(): Promise<void> {
  const request = ++agendaRequest;
  state.loading = true;
  state.appointments = [];
  render();
  try {
    const result = await api<{ appointments: AgendaItem[] }>(
      `/api/admin/bookings?date=${state.date}`,
    );
    if (request === agendaRequest) state.appointments = result.appointments;
  } catch (error) {
    if (request === agendaRequest) handleError(error);
  } finally {
    if (request === agendaRequest) {
      state.loading = false;
      render();
    }
  }
}
function handleError(error: unknown): void {
  state.error = error instanceof Error ? error.message : 'Tente novamente.';
  if (error instanceof RequestError && error.status === 401 && isHub) {
    state.loggedIn = false;
    state.booking = false;
  }
}
function resetBooking(): void {
  state.receipt = undefined;
  state.step = 1;
  state.startsAt = 0;
  state.key = crypto.randomUUID();
  state.error = '';
  state.name = '';
  state.phone = '';
}
app.addEventListener('click', async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!button || button.disabled || state.busy) return;
  state.error = '';
  if (button.dataset.service) {
    state.serviceId = button.dataset.service;
    state.startsAt = 0;
    state.key = crypto.randomUUID();
    render();
    document
      .querySelector<HTMLButtonElement>(`[data-service="${state.serviceId}"]`)
      ?.focus({ preventScroll: true });
    return;
  }
  if (button.dataset.date) {
    state.date = button.dataset.date;
    await loadSlots();
    return;
  }
  if (button.dataset.time) {
    state.startsAt = Number(button.dataset.time);
    state.key = crypto.randomUUID();
    render();
    document
      .querySelector<HTMLButtonElement>(`[data-time="${state.startsAt}"]`)
      ?.focus({ preventScroll: true });
    return;
  }
  switch (button.dataset.action) {
    case 'next':
      state.step++;
      render();
      if (state.step === 2) await loadSlots();
      focusStage();
      break;
    case 'back':
      state.step--;
      state.key = crypto.randomUUID();
      render();
      if (state.step === 2) await loadSlots();
      focusStage();
      break;
    case 'new':
      resetBooking();
      state.booking = true;
      render();
      focusStage();
      break;
    case 'restart':
      resetBooking();
      if (isHub) {
        state.booking = false;
        await loadAgenda();
      } else render();
      focusStage();
      break;
    case 'agenda':
      state.booking = false;
      resetBooking();
      await loadAgenda();
      focusStage();
      break;
    case 'refresh':
      await loadAgenda();
      break;
    case 'logout':
      try {
        await api('/api/admin/logout', {});
        state.loggedIn = false;
        state.appointments = [];
        render();
      } catch (error) {
        handleError(error);
        render();
      }
      break;
  }
});
app.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement;
  if (
    !target.matches('[data-service]') ||
    !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
  )
    return;
  event.preventDefault();
  const index = state.services.findIndex((s) => s.id === state.serviceId);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? state.services.length - 1
        : (index +
            (['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : state.services.length - 1)) %
          state.services.length;
  document.querySelector<HTMLButtonElement>(`[data-service="${state.services[next].id}"]`)?.click();
});
app.addEventListener('change', async (event) => {
  const input = event.target as HTMLInputElement;
  if (input.id === 'date' && input.value) {
    state.date = input.value;
    state.error = '';
    await loadSlots();
  }
  if (input.id === 'agenda-date' && input.value) {
    state.date = input.value;
    state.error = '';
    await loadAgenda();
  }
});
app.addEventListener('input', (event) => {
  const input = event.target as HTMLInputElement;
  if (input.id === 'name' || input.id === 'phone') {
    state[input.id] = input.value;
    state.key = crypto.randomUUID();
  }
});
app.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.busy) return;
  const form = event.target as HTMLFormElement;
  if (!form.reportValidity()) return;
  state.error = '';
  if (form.id === 'login-form') {
    const password = form.querySelector<HTMLInputElement>('#password')!.value;
    state.busy = true;
    render();
    try {
      await api('/api/admin/login', { password });
      state.loggedIn = true;
      state.busy = false;
      await loadAgenda();
    } catch (error) {
      handleError(error);
    } finally {
      state.busy = false;
      render();
      if (state.loggedIn) focusStage();
      else
        document
          .querySelector<HTMLElement>('.error:not([hidden])')
          ?.scrollIntoView({ block: 'center' });
    }
  }
  if (form.id === 'booking-form') {
    state.busy = true;
    render();
    try {
      state.receipt = (
        await api<{ appointment: Receipt }>(`${bookingBase()}/bookings`, {
          name: state.name,
          phone: state.phone,
          serviceId: state.serviceId,
          startsAt: state.startsAt,
          requestKey: state.key,
        })
      ).appointment;
    } catch (error) {
      handleError(error);
      if (error instanceof RequestError && error.status === 409) {
        state.step = 2;
        state.key = crypto.randomUUID();
        await loadSlots();
      }
    } finally {
      state.busy = false;
      render();
      if (state.receipt) focusStage();
      else
        document
          .querySelector<HTMLElement>('.error:not([hidden])')
          ?.scrollIntoView({ block: 'center' });
    }
  }
});
async function start(): Promise<void> {
  shell('<p class="empty" role="status">Preparando a agenda…</p>');
  try {
    state.services = (await api<{ services: Service[] }>('/api/services')).services;
    if (isHub) {
      try {
        await api('/api/admin/session');
        state.loggedIn = true;
        await loadAgenda();
      } catch (error) {
        if (!(error instanceof RequestError && error.status === 401)) handleError(error);
      }
    }
    render();
  } catch (error) {
    handleError(error);
    shell(
      `<section class="login"><h1>Vamos tentar de novo.</h1>${errorBox()}<a class="primary" href="${isHub ? '/hub' : '/'}">Recarregar a página</a></section>`,
    );
  }
}
void start();
