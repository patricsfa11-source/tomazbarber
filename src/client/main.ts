import '@fontsource-variable/geist/wght.css';
import './style.css';
import { createAgendaManagement } from './agenda-management';
import { createMyBookings } from './my-bookings';
import { createReservationAccess } from './reservation-access';
import { createServiceManagement } from './service-management';
import { createHubTools } from './hub-tools';
import { copyText } from './clipboard';
import { createReceipts } from './receipts';
import { serviceIcon } from './service-icons';
import { money, paymentMethods } from '../finance';
import type { AppointmentRecord } from '../calendar';
import {
  addDays,
  dateLabel as formatDate,
  localDate as formatLocalDate,
  timeLabel as formatTime,
  timezone as defaultTimezone,
  hoursLabel,
  type Shop,
  type Service,
} from '../shared';

const app = document.querySelector<HTMLDivElement>('#app')!;
const route = location.pathname.match(
  /^\/s\/([^/]+)(\/hub|\/meus-horarios|\/reserva\/[a-f0-9-]{36})?\/?$/,
);
const shopSlug = route ? route[1] : 'tomaz-barber';
const publicPath = `/s/${encodeURIComponent(shopSlug)}`;
const hubPath = `${publicPath}/hub`;
const apiRoot = `/api/shops/${encodeURIComponent(shopSlug)}`;
const isHub = route?.[2] === '/hub' || location.pathname.replace(/\/$/, '') === '/hub';
const isCustomer =
  route?.[2] === '/meus-horarios' || location.pathname.replace(/\/$/, '') === '/meus-horarios';
const privateId = route?.[2]?.match(/^\/reserva\/([a-f0-9-]{36})$/)?.[1] || '';
const isPrivate = Boolean(privateId);
const customerPath = `${publicPath}/meus-horarios`;
let timezone = defaultTimezone;
const localDate = (date = new Date()) => formatLocalDate(date, timezone);
const dateLabel = (date: string) => formatDate(date, timezone);
const timeLabel = (seconds: number) => formatTime(seconds, timezone);
const state = {
  shop: null as Shop | null,
  customers: [] as Customer[],
  customerCursor: null as string | null,
  hubView: 'agenda' as 'agenda' | 'customers' | 'settings' | 'services',
  agendaStatus: 'confirmed' as 'confirmed' | 'all',
  notice: '',
  phoneVerification: false,
  customerForm: false,
  newCustomerName: '',
  newCustomerPhone: '',
  services: [] as Service[],
  serviceId: 'corte',
  serviceQuery: '',
  shopDetails: false,
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
interface Customer {
  id: string;
  full_name: string;
  phone: string;
}
interface Receipt {
  id: string;
  service: string;
  price: string;
  duration: number;
  startsAt: number;
  endsAt: number;
  manageUrl: string | null;
}
type AgendaItem = AppointmentRecord;
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
  const scopedPath = path.startsWith('/api/') ? `${apiRoot}${path.slice(4)}` : path;
  let response: Response;
  try {
    response = await fetch(scopedPath, {
      method: data === undefined ? 'GET' : 'POST',
      headers: data === undefined ? {} : { 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  } catch {
    throw new RequestError(
      0,
      'Não foi possível confirmar a resposta. Confira a conexão e tente novamente com os mesmos dados.',
    );
  }
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new RequestError(
      response.status,
      result.error || 'Não foi possível carregar. Tente novamente.',
    );
  return result;
}
const bookingBase = () => (isHub ? '/api/admin' : '/api');
const shopName = () => state.shop?.name || 'Agenda';
const shopHours = () => (state.shop ? hoursLabel(state.shop) : '');
const zoneLabel = () => (timezone === 'America/Bahia' ? 'Horário da Bahia' : 'Horário local');
function brand(): string {
  return `<a class="brand" href="${publicPath}" aria-label="${escape(shopName())}, início">${state.shop?.logoUrl ? `<img src="${escape(state.shop.logoUrl)}" width="900" height="1600" alt="" />` : `<span class="brand-name">${escape(shopName())}</span>`}</a>`;
}
function publicCover(): string {
  if (!state.shop) return '<header class="shop-cover"><h1>Preparando a agenda…</h1></header>';
  const initials = shopName()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('');
  return `<header class="shop-cover">${state.shop.logoUrl ? `<img src="${escape(state.shop.logoUrl)}" width="900" height="1600" alt="" fetchpriority="high">` : `<span class="shop-initials" aria-hidden="true">${escape(initials)}</span>`}<h1>${escape(shopName())}</h1></header>`;
}
function shell(content: string): void {
  app.innerHTML = `<div class="demo-bar">AMBIENTE DE TESTE <span>·</span> Utilize apenas dados fictícios</div>
    ${!isHub && !isCustomer && !isPrivate && state.step === 1 ? publicCover() : `<header>${brand()}<nav aria-label="Navegação principal"><a href="${publicPath}" ${!isHub && !isCustomer && !isPrivate ? 'aria-current="page"' : ''}>Agendar</a><a href="${customerPath}" ${isCustomer ? 'aria-current="page"' : ''}>Meus horários</a>${isCustomer ? '' : `<a href="${hubPath}" ${isHub ? 'aria-current="page"' : ''}>${shopSlug === 'tomaz-barber' ? 'Hub do barbeiro' : 'Painel do salão'} <span aria-hidden="true">→</span></a>`}</nav></header>`}
    <main${!isHub && !isCustomer && !isPrivate && state.step === 1 ? ' class="shop-main"' : ''}>${isHub ? hubTools.render() : ''}${content}</main><footer><span>${escape(shopName())}</span><p>${escape(shopHours())}<br>${zoneLabel()}</p><small>Feito para cuidar do seu tempo.</small></footer>`;
  if (isHub) hubTools.afterRender();
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
const searchKey = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

function publicCatalog(): string {
  return `<nav class="shop-nav" aria-label="Informações do estabelecimento">
    <button type="button" data-action="services" aria-pressed="${!state.shopDetails}">Serviços</button>
    <button type="button" data-action="details" aria-pressed="${state.shopDetails}">Detalhes</button>
    <a href="${customerPath}">Meus horários</a>
  </nav>
  ${
    state.shopDetails
      ? `<section class="shop-details"><h2>Horário de atendimento</h2><p>${escape(shopHours())}</p><p>${zoneLabel()}</p></section>`
      : `<section class="shop-catalog" aria-label="Serviços">
      ${errorBox()}
      <div class="shop-search"><span aria-hidden="true"></span><input id="service-search" type="search" aria-label="Pesquisar serviço" placeholder="Pesquisar serviço..." value="${escape(state.serviceQuery)}"></div>
      <ul class="shop-services">${state.services
        .map(
          (
            service,
          ) => `<li data-service-name="${escape(searchKey(service.name))}" ${searchKey(service.name).includes(searchKey(state.serviceQuery)) ? '' : 'hidden'}>
        <span class="shop-service-icon" aria-hidden="true">${serviceIcon(service.id)}</span>
        <div class="shop-service-info"><h2>${escape(service.name)}</h2><p><span>${escape(service.price)}</span><small>${service.duration} min</small></p></div>
        <button type="button" class="primary shop-book" data-public-service="${escape(service.id)}" aria-label="Agendar ${escape(service.name)}">Agendar</button>
      </li>`,
        )
        .join('')}</ul>
      <p class="shop-empty" role="status" ${state.services.some((service) => searchKey(service.name).includes(searchKey(state.serviceQuery))) ? 'hidden' : ''}>Nenhum serviço encontrado.</p>
    </section>`
  }`;
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
    <p class="date-caption">${escape(dateLabel(state.date))} <span>· ${zoneLabel()}</span></p>
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
          : `<div class="empty"><strong>Nenhum horário disponível.</strong><p>Não há uma faixa livre para este serviço nesta data. Escolha outra data.</p></div>`
    }</div>
    <div class="actions"><button class="text-button" data-action="back">← Voltar</button><button class="primary" data-action="next" ${!state.startsAt || state.loading ? 'disabled' : ''}>Continuar <span aria-hidden="true">→</span></button></div>`;
}
function detailsView(): string {
  return `<span class="eyebrow">03 / REVISE E CONFIRME</span><h2>Quase tudo pronto.</h2><p class="muted">${isHub ? 'Informe os dados do cliente para registrar o encaixe.' : 'Só precisamos de dois dados para reservar seu horário.'}</p>
    <form id="booking-form"><div class="fields"><label for="name">Nome completo<input id="name" name="name" autocomplete="name" required minlength="5" maxlength="100" value="${escape(state.name)}" placeholder="Ex.: João da Silva"></label><label for="phone">Celular com DDD<input id="phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" required maxlength="20" value="${escape(state.phone)}" placeholder="(75) 99999-9999"></label></div>
    <div class="review"><h3>Confira sua reserva</h3><p><strong>${escape(selected().name)}</strong><span>${escape(selected().price)}</span></p><p>${escape(dateLabel(state.date))}<strong>${timeLabel(state.startsAt)} · ${selected().duration} min</strong></p></div>
    <div class="rules"><h3>Para o seu atendimento</h3><ul><li>Chegue 10 minutos antes. A tolerância é de 10 minutos após o início.</li><li>Cancelamento sem custo com pelo menos 2 horas de antecedência.</li><li>Em caso de falta, taxa de R$ 15,00 tratada presencialmente.</li></ul><p>Depois de reservar, guarde o link privado exibido na confirmação para consultar ou alterar este atendimento pelo navegador. Com menos de 2 horas, combine alterações diretamente com o salão.</p></div>
    <div class="actions"><button type="button" class="text-button" data-action="back" ${state.busy ? 'disabled' : ''}>← Voltar</button><button type="submit" class="primary" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Confirmando…' : isHub ? 'Confirmar encaixe' : 'Confirmar reserva'} <span aria-hidden="true">✓</span></button></div></form>`;
}
function confirmation(): string {
  const r = state.receipt!;
  return `<section class="confirmation"><span class="success-mark" aria-hidden="true">✓</span><span class="eyebrow">HORÁRIO GARANTIDO</span><h1>${isHub ? 'Encaixe confirmado.' : 'Nos vemos em breve.'}</h1><p>Seu horário está reservado em ${escape(shopName())}.</p><div class="confirmed-details"><span>${escape(dateLabel(localDate(new Date(r.startsAt * 1000))))}</span><strong>${timeLabel(r.startsAt)}</strong><h2>${escape(r.service)}</h2><p>${escape(r.price)} · ${r.duration} minutos</p><small>Reserva ${escape(r.id.slice(0, 8).toUpperCase())}</small></div><p class="muted">Chegue 10 minutos antes do horário. Sua confirmação está aqui na tela.</p>${r.manageUrl ? `<a class="primary my-receipt-link" href="${escape(r.manageUrl || customerPath)}" data-private-receipt-link>Consultar ou alterar esta reserva <span aria-hidden="true">→</span></a><button class="text-button" data-action="copy-private-link">Copiar link privado</button><p class="note private-link-note">Guarde este link. Quem tiver acesso a ele poderá consultar e alterar somente esta reserva.</p>` : ''}<p class="success-note" role="status" data-copy-status hidden></p><button class="${isHub ? 'primary' : 'text-button'}" data-action="restart">${isHub ? 'Voltar à agenda' : 'Fazer outra reserva'} <span aria-hidden="true">→</span></button></section>`;
}
function renderBooking(): void {
  if (isHub && state.services.length === 0 && !state.receipt) {
    shell(
      `<section class="agenda"><h1>Nenhum serviço ativo.</h1><p>Ative ou cadastre um serviço para registrar novos agendamentos.</p><button class="primary" data-action="manage-services">Gerenciar serviços</button><button class="text-button" data-action="agenda">Voltar à agenda do hub</button></section>`,
    );
    return;
  }

  if (state.receipt) {
    shell(confirmation());
    return;
  }
  if (!isHub && state.step === 1) {
    shell(publicCatalog());
    return;
  }
  shell(
    `${isHub ? '<section class="intro"><span class="eyebrow">HUB / NOVO ENCAIXE</span><h1>Um lugar na agenda.</h1><p>A mesma agenda, para quem chega pelo link ou pela porta.</p></section>' : ''}${steps()}<div class="booking-layout"><section class="booking-content">${errorBox()}${state.step === 1 ? serviceView() : state.step === 2 ? datesView() : detailsView()}${isHub ? '<button class="text-button close-booking" data-action="agenda">Voltar à agenda do hub</button>' : ''}</section>${summary()}</div>`,
  );
}
function renderLogin(): void {
  shell(
    `<section class="login"><span class="eyebrow">${escape(shopName())} / ACESSO AO PAINEL</span><h1>Sua agenda,<br>em um só lugar<span>.</span></h1><p class="muted">Entre para acompanhar os horários e registrar encaixes.</p>${errorBox()}<form id="login-form"><label for="password">Senha do hub<input id="password" type="password" autocomplete="current-password" required maxlength="200"></label><button class="primary" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Entrando…' : 'Entrar no hub'} <span aria-hidden="true">→</span></button></form><p class="note">Acesso restrito · Ambiente de testes</p></section>`,
  );
}
function renderAgenda(): void {
  const today = localDate();
  shell(`<section class="hub-heading"><div><span class="eyebrow">${escape(shopName())} / AGENDA DIÁRIA</span><h1>O dia começa aqui<span>.</span></h1><p class="muted">Reservas pelo link e encaixes, na mesma agenda.</p></div><button class="text-button" data-action="logout">Sair do hub →</button></section>
    ${hubTabs()}<section class="agenda"><div class="agenda-toolbar"><div><label for="agenda-date">Data da agenda</label><input type="date" id="agenda-date" value="${state.date}" max="${addDays(today, 90)}"></div><button class="primary" data-action="new">+ Novo encaixe</button></div><div class="agenda-day"><h2>${escape(dateLabel(state.date))}</h2><div><span>${state.appointments.length} atendimento${state.appointments.length !== 1 ? 's' : ''}</span><button class="text-button" data-action="refresh">Atualizar ↻</button></div></div><nav class="agenda-filters" aria-label="Situação dos atendimentos"><button class="text-button" data-action="active-bookings" aria-pressed="${state.agendaStatus === 'confirmed'}">Ativos</button><button class="text-button" data-action="booking-history" aria-pressed="${state.agendaStatus === 'all'}">Histórico</button></nav>${errorBox()}${state.notice ? `<p class="success-note" role="status">${escape(state.notice)}</p>` : ''}
    <div aria-live="polite">${state.loading ? '<p class="empty">Carregando agenda…</p>' : state.appointments.length ? `<ol class="appointments">${state.appointments.map((a) => `<li><div class="appointment-time"><strong>${timeLabel(a.starts_at)}</strong><span>${timeLabel(a.ends_at)}</span></div><div class="appointment-info"><span class="tag">${a.origin === 'hub' ? 'ENCAIXE / HUB' : 'RESERVA / LINK'}</span><h3>${escape(a.customer_name)}</h3><p>${escape(a.service_name)} · ${escape(a.price_label)}</p><a href="https://wa.me/${escape(a.customer_phone.replace(/\D/g, ''))}" target="_blank" rel="noopener noreferrer" aria-label="Conversar com ${escape(a.customer_name)} pelo WhatsApp">${escape(a.customer_phone)} · WhatsApp</a><div class="row-actions">${a.status === 'confirmed' && !a.completed_at ? `<button class="text-button" data-reschedule="${a.id}">Remarcar</button><button class="text-button danger-text" data-cancel="${a.id}">Cancelar</button>` : ''}<button class="text-button" data-history="${a.id}">Ver histórico</button>${a.status === 'confirmed' && !a.completed_at ? `<button class="text-button" data-complete="${a.id}" ${a.starts_at * 1000 > Date.now() ? 'disabled title="Disponível após o início do atendimento"' : ''}>Concluir atendimento</button>` : ''}<button class="text-button" data-payment="${a.id}">${a.payment_amount_cents != null ? 'Ver recebimento' : 'Registrar pagamento'}</button></div>${a.payment_amount_cents != null ? `<p class="agenda-payment">Recebido ${money(a.payment_amount_cents)} · ${paymentMethods[a.payment_method!]} · ${a.payment_paid_on!.split('-').reverse().join('/')}</p>` : '<p class="agenda-payment muted">Sem recebimento registrado</p>'}</div><span class="status ${a.status === 'cancelled' ? 'cancelled' : ''}">${a.status === 'cancelled' ? 'Cancelado' : a.completed_at ? 'Concluído' : 'Confirmado'}</span></li>`).join('')}</ol>` : '<div class="empty"><span class="empty-icon" aria-hidden="true">◷</span><h3>Um dia cheio de possibilidades.</h3><p>Nenhum atendimento nesta data. Os agendamentos aparecem aqui assim que são confirmados.</p></div>'}</div><p class="note">${zoneLabel()} · Atualize a agenda para consultar novas reservas.</p></section>`);
}
function hubTabs(): string {
  return `<nav class="hub-tabs" aria-label="Painel do estabelecimento"><button class="text-button" data-action="agenda-view" aria-pressed="${state.hubView === 'agenda' && !receivables.active()}">Agenda</button><button class="text-button" data-action="customers" aria-pressed="${state.hubView === 'customers' && !receivables.active()}">Clientes</button><button class="text-button" data-action="settings" aria-pressed="${state.hubView === 'settings' && !receivables.active()}">Configurar agenda</button><button class="text-button" data-action="manage-services" aria-pressed="${serviceManagement.active()}">Serviços</button><button class="text-button" data-action="receipts" aria-pressed="${receivables.isReport()}">Recebimentos</button></nav>`;
}
function renderCustomers(): void {
  shell(
    `<section class="hub-heading"><div><span class="eyebrow">${escape(shopName())} / CLIENTES</span><h1>Seus clientes<span>.</span></h1><p class="muted">Clientes cadastrados nos agendamentos de ${escape(shopName())}.</p></div><button class="text-button" data-action="logout">Sair do hub →</button></section>${hubTabs()}<section class="agenda">${errorBox()}${state.notice ? `<p class="success-note" role="status">${escape(state.notice)}</p>` : ''}<button class="primary" data-action="customer-form">${state.customerForm ? 'Fechar cadastro' : '+ Cadastrar cliente'}</button>${state.customerForm ? `<form id="register-customer" class="customer-register settings-card"><h2>Cadastrar cliente</h2><label for="customer-name">Nome completo do cliente<input id="customer-name" required minlength="5" maxlength="100" autocomplete="name" value="${escape(state.newCustomerName)}"></label><label for="customer-phone">Celular do cliente com DDD<input id="customer-phone" type="tel" autocomplete="tel" required maxlength="20" value="${escape(state.newCustomerPhone)}"></label><button class="primary" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Salvando…' : 'Salvar cliente'}</button></form>` : ''}${state.loading ? '<p class="empty" role="status">Carregando clientes…</p>' : state.customers.length ? `<ul class="customers">${state.customers.map((c) => `<li><h3>${escape(c.full_name)}</h3><a href="https://wa.me/${escape(c.phone.replace(/\D/g, ''))}" target="_blank" rel="noopener noreferrer" aria-label="Conversar com ${escape(c.full_name)} pelo WhatsApp">${escape(c.phone)} · WhatsApp</a><button class="text-button" data-customer-book="${escape(c.id)}">Marcar horário</button></li>`).join('')}</ul>` : '<p class="empty">Nenhum cliente cadastrado neste estabelecimento.</p>'}${state.customerCursor ? '<button class="primary" data-action="more-customers">Carregar mais clientes</button>' : ''}</section>`,
  );
}
let customerRequest = 0;
async function loadCustomers(more = false): Promise<void> {
  const request = ++customerRequest;
  state.hubView = 'customers';
  state.loading = true;
  if (!more) {
    state.customers = [];
    state.customerCursor = null;
  }
  render();
  try {
    const result = await api<{ customers: Customer[]; nextCursor: string | null }>(
      `/api/admin/customers${more ? `?after=${encodeURIComponent(state.customerCursor || '')}` : ''}`,
    );
    if (request === customerRequest) {
      state.customers = more ? [...state.customers, ...result.customers] : result.customers;
      state.customerCursor = result.nextCursor;
    }
  } catch (error) {
    if (request === customerRequest) handleError(error);
  } finally {
    if (request === customerRequest) {
      state.loading = false;
      render();
    }
  }
}
function render(): void {
  if (isPrivate) reservationAccess.render();
  else if (isCustomer) myBookings.render();
  else if (!isHub || state.booking) renderBooking();
  else if (!state.loggedIn) renderLogin();
  else if (serviceManagement.active()) serviceManagement.render();
  else if (receivables.active()) receivables.render();
  else if (management.active()) management.render();
  else if (state.hubView === 'customers') renderCustomers();
  else renderAgenda();
}
function focusStage(): void {
  const target =
    document.querySelector<HTMLElement>('.booking-content h2') ??
    document.querySelector<HTMLElement>('main h1, .shop-nav button[aria-pressed="true"]');
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
  state.hubView = 'agenda';
  const request = ++agendaRequest;
  state.loading = true;
  state.appointments = [];
  render();
  try {
    const result = await api<{ appointments: AgendaItem[] }>(
      `/api/admin/bookings?date=${state.date}&status=${state.agendaStatus}`,
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
    state.customers = [];
    state.appointments = [];
    management.close();
    receivables.close();
    serviceManagement.close();
  }
}
function resetBooking(): void {
  state.receipt = undefined;
  state.serviceQuery = '';
  state.shopDetails = false;
  state.step = 1;
  state.startsAt = 0;
  state.key = crypto.randomUUID();
  state.error = '';
  state.name = '';
  state.phone = '';
}
const management = createAgendaManagement({
  api,
  shell,
  tabs: hubTabs,
  escape,
  shop: () => state.shop!,
  localDate,
  dateLabel,
  timeLabel,
  render,
  onError: handleError,
  onConfig: (config) => {
    if (state.shop)
      state.shop.hours = config.days
        .filter((d) => d.enabled)
        .map((d) => ({ weekday: d.weekday, opensAt: d.opensAt, closesAt: d.closesAt }));
  },
  setSettings: () => {
    state.hubView = 'settings';
    state.booking = false;
  },
  onDone: async (message, date) => {
    state.notice = message;
    state.date = date;
    state.agendaStatus = 'confirmed';
    await loadAgenda();
  },
});
const receivables = createReceipts({
  api,
  shell,
  tabs: hubTabs,
  escape,
  shop: () => state.shop!,
  onError: handleError,
  prepare: () => {
    management.close();
    state.booking = false;
  },
  onDone: async (message) => {
    receivables.close();
    state.notice = message;
    await loadAgenda();
  },
});
const serviceManagement = createServiceManagement({
  api,
  shell,
  tabs: hubTabs,
  escape,
  render,
  onError: handleError,
  prepare: () => {
    management.close();
    receivables.close();
    state.booking = false;
    state.hubView = 'services';
  },
  onSaved: (services) => {
    state.services = services;
    state.serviceId = services[0]?.id || '';
    resetBooking();
  },
});
const myBookings = createMyBookings({
  api,
  shell,
  escape,
  shop: () => state.shop!,
  publicPath,
  verificationAvailable: () => state.phoneVerification,
});
const hubTools = createHubTools({
  shop: () => state.shop,
  publicPath,
  escape,
  isLoggedIn: () => state.loggedIn,
});
const reservationAccess = createReservationAccess({
  id: privateId,
  shop: () => state.shop!,
  api,
  shell,
  escape,
  publicPath,
});
app.addEventListener('click', async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (
    !button ||
    button.disabled ||
    state.busy ||
    management.busy ||
    receivables.busy ||
    serviceManagement.busy
  )
    return;
  if (isPrivate) {
    await reservationAccess.click(button);
    return;
  }
  if (isHub && (await hubTools.click(button, render))) return;
  if (isCustomer) {
    await myBookings.click(button);
    return;
  }
  state.error = '';
  state.notice = '';
  if (isHub && state.loggedIn && (await serviceManagement.click(button))) return;
  if (isHub && state.loggedIn && (await receivables.click(button))) return;
  if (
    isHub &&
    [
      'agenda-view',
      'customers',
      'settings',
      'logout',
      'new',
      'active-bookings',
      'booking-history',
    ].includes(button.dataset.action || '')
  )
    receivables.close();
  if (isHub && state.loggedIn && (await management.click(button))) return;
  if (button.dataset.publicService) {
    state.serviceId = button.dataset.publicService;
    state.startsAt = 0;
    state.key = crypto.randomUUID();
    state.step = 2;
    await loadSlots();
    focusStage();
    return;
  }
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
  if (button.dataset.customerBook) {
    const c = state.customers.find((c) => c.id === button.dataset.customerBook);
    if (c) {
      management.close();
      resetBooking();
      state.name = c.full_name;
      state.phone = c.phone;
      state.booking = true;
      render();
      focusStage();
    }
    return;
  }
  switch (button.dataset.action) {
    case 'copy-private-link':
      if (state.receipt?.manageUrl) {
        try {
          await copyText(new URL(state.receipt.manageUrl, location.origin).href);
          const n = document.querySelector<HTMLElement>('[data-copy-status]');
          if (n) {
            n.textContent = 'Link privado copiado. Guarde com cuidado.';
            n.hidden = false;
          }
        } catch (error) {
          handleError(error);
          render();
        }
      }
      break;
    case 'customer-form':
      state.customerForm = !state.customerForm;
      render();
      break;
    case 'services':
    case 'details':
      state.shopDetails = button.dataset.action === 'details';
      render();
      app.querySelector<HTMLButtonElement>(`[data-action="${button.dataset.action}"]`)?.focus();
      break;
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
      management.close();
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
    case 'settings':
      await management.openSettings();
      break;
    case 'active-bookings':
      management.close();
      state.agendaStatus = 'confirmed';
      await loadAgenda();
      break;
    case 'booking-history':
      management.close();
      state.agendaStatus = 'all';
      await loadAgenda();
      break;
    case 'agenda-view':
      management.close();
      await loadAgenda();
      break;
    case 'customers':
      management.close();
      await loadCustomers();
      break;
    case 'more-customers':
      await loadCustomers(true);
      break;
    case 'refresh':
      await loadAgenda();
      break;
    case 'logout':
      management.close();
      try {
        await api('/api/admin/logout', {});
        state.loggedIn = false;
        state.appointments = [];
        state.customers = [];
        state.customerCursor = null;
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
  if (isPrivate) {
    await reservationAccess.change(input);
    return;
  }
  if (isCustomer) {
    await myBookings.change(input);
    return;
  }
  if (isHub && state.loggedIn && receivables.change(input)) return;
  if (isHub && state.loggedIn && (await management.change(input))) return;
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
  if (input.id === 'customer-name') state.newCustomerName = input.value;
  if (input.id === 'customer-phone') state.newCustomerPhone = input.value;
  if (isCustomer) {
    myBookings.input(input);
    return;
  }
  if (isHub && state.loggedIn && receivables.input(input)) return;
  if (isHub && state.loggedIn && management.input(input)) return;
  if (input.id === 'service-search') {
    state.serviceQuery = input.value;
    const query = searchKey(input.value);
    let hasMatches = false;
    app.querySelectorAll<HTMLLIElement>('[data-service-name]').forEach((row) => {
      row.hidden = !row.dataset.serviceName?.includes(query);
      hasMatches ||= !row.hidden;
    });
    const empty = app.querySelector<HTMLElement>('.shop-empty');
    if (empty) empty.hidden = hasMatches;
  }
  if (input.id === 'name' || input.id === 'phone') {
    state[input.id] = input.value;
    state.key = crypto.randomUUID();
  }
});
app.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.busy || management.busy || receivables.busy || serviceManagement.busy) return;
  const form = event.target as HTMLFormElement;
  if (!form.reportValidity()) return;
  if (isCustomer) {
    await myBookings.submit(form);
    return;
  }
  state.error = '';
  if (isHub && state.loggedIn && (await serviceManagement.submit(form))) return;
  if (isHub && state.loggedIn && (await receivables.submit(form))) return;
  if (isHub && state.loggedIn && (await management.submit(form))) return;
  if (form.id === 'register-customer') {
    state.busy = true;
    render();
    try {
      await api('/api/admin/customers', {
        name: state.newCustomerName,
        phone: state.newCustomerPhone,
      });
      state.newCustomerName = '';
      state.newCustomerPhone = '';
      state.customerForm = false;
      state.notice = 'Cliente cadastrado. Você já pode marcar um horário.';
      await loadCustomers();
    } catch (error) {
      handleError(error);
    } finally {
      state.busy = false;
      render();
    }
    return;
  }
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
    const catalog = await api<{
      shop: Shop;
      services: Service[];
      features?: { phoneVerification: boolean };
    }>('/api/services');
    state.shop = catalog.shop;
    state.phoneVerification = Boolean(catalog.features?.phoneVerification);
    state.services = catalog.services;
    timezone = catalog.shop.timezone;
    state.date = localDate();
    state.serviceId = catalog.services[0]?.id || '';
    document.title = `${shopName()} · ${isHub ? 'Hub' : 'Seu próximo horário'}`;
    if (isPrivate) {
      document.title = `${shopName()} · Sua reserva`;
      await reservationAccess.start();
      return;
    }
    if (isHub) void hubTools.start();
    if (isCustomer) {
      document.title = `${shopName()} · Meus horários`;
      await myBookings.start();
      return;
    }
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
      `<section class="login"><h1>Vamos tentar de novo.</h1>${errorBox()}<a class="primary" href="${isHub ? hubPath : publicPath}">Recarregar a página</a></section>`,
    );
  }
}
void start();
