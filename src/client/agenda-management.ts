import type {
  ScheduleView,
  ScheduleCommand,
  SchedulePreview,
  Weekday,
  Pause,
  AppointmentDetail,
  AffectedBooking,
} from '../calendar';
import { addDays, type Shop } from '../shared';
interface Options {
  api: <T>(path: string, data?: unknown) => Promise<T>;
  shell: (html: string) => void;
  tabs: () => string;
  escape: (value: unknown) => string;
  shop: () => Shop;
  localDate: (date?: Date) => string;
  dateLabel: (date: string) => string;
  timeLabel: (seconds: number) => string;
  render: () => void;
  onError: (error: unknown) => void;
  setSettings: () => void;
  onConfig: (config: ScheduleView) => void;
  onDone: (message: string, date: string) => Promise<void>;
}
const dayNames = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const inputTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const minutes = (value: string, end = false) => {
  const [h, m] = value.split(':').map(Number);
  return end && h === 0 && m === 0 ? 1440 : h * 60 + m;
};
export function createAgendaManagement(o: Options) {
  const e = o.escape;
  let view: null | 'settings' | 'reschedule' | 'cancel' | 'history' = null;
  let editor: 'weekly' | 'special' | 'rules' = 'weekly';
  let cfg: ScheduleView | null = null,
    weekly: Weekday[] = [];
  let special = {
    from: o.localDate(),
    to: o.localDate(),
    closed: false,
    opensAt: 540,
    closesAt: 1080,
    breaks: [] as Pause[],
  };
  let restriction = {
    from: o.localDate(),
    to: o.localDate(),
    startsAt: 720,
    endsAt: 780,
    scope: 'online' as 'online' | 'all',
  };
  let preview: SchedulePreview | null = null,
    detail: AppointmentDetail | null = null;
  let returnToSettings = false,
    actionDate = o.localDate(),
    slots: number[] = [],
    newStart = 0,
    actionKey = crypto.randomUUID() as string;
  let busy = false,
    loading = false,
    error = '',
    notice = '';
  const errorBox = () => (error ? `<div class="error" role="alert">${e(error)}</div>` : '');
  const dateOf = (seconds: number) => o.localDate(new Date(seconds * 1000));
  const when = (start: number, end: number) =>
    `${o.dateLabel(dateOf(start))} · ${o.timeLabel(start)}–${o.timeLabel(end)}`;
  function fail(err: unknown) {
    error = err instanceof Error ? err.message : 'Não foi possível concluir.';
    o.onError(err);
  }
  function timeField(label: string, value: number, attrs: string, disabled = false) {
    return `<label>${label}<input type="time" step="600" value="${inputTime(value)}" ${attrs} ${disabled ? 'disabled' : ''} required></label>`;
  }
  function affectedList(rows: AffectedBooking[], actions = false) {
    return rows.length
      ? `<ul class="affected-list">${rows.map((a) => `<li><strong>${e(a.customer_name)}</strong><span>${e(a.service_name)}</span><p>${e(when(a.starts_at, a.ends_at))}</p>${actions ? `<div class="row-actions"><button type="button" class="text-button" data-reschedule="${e(a.id)}">Remarcar</button><button type="button" class="text-button danger-text" data-cancel="${e(a.id)}">Cancelar</button></div>` : ''}</li>`).join('')}</ul>`
      : '<p class="muted">Nenhuma reserva confirmada afetada.</p>';
  }
  function pausesFields(pauses: Pause[], day?: number) {
    return pauses
      .map(
        (p, i) =>
          `<div class="pause-row">${timeField(`Início da pausa ${i + 1}${day !== undefined ? ` de ${dayNames[day].toLowerCase()}` : ''}`, p.startsAt, day !== undefined ? `data-weekday="${day}" data-pause="${i}" data-field="startsAt"` : `data-special-pause="${i}" data-field="startsAt"`)}${timeField(`Fim da pausa ${i + 1}${day !== undefined ? ` de ${dayNames[day].toLowerCase()}` : ''}`, p.endsAt, day !== undefined ? `data-weekday="${day}" data-pause="${i}" data-field="endsAt"` : `data-special-pause="${i}" data-field="endsAt"`)}<button type="button" class="text-button" aria-label="Remover pausa ${i + 1}${day !== undefined ? ` de ${dayNames[day].toLowerCase()}` : ' especial'}" ${day !== undefined ? `data-remove-pause="${i}" data-day="${day}"` : `data-remove-special-pause="${i}"`}>Remover</button></div>`,
      )
      .join('');
  }
  function weeklyForm() {
    return `<section class="settings-card"><span class="eyebrow">EXPEDIENTE PADRÃO</span><h2>Como funciona sua semana?</h2><p class="muted">Marque os dias de atendimento e ajuste os horários e as pausas. As pausas fecham os dois canais.</p><form id="weekly-schedule">${weekly.map((d) => `<fieldset class="weekday"><legend><label class="check-label"><input type="checkbox" aria-label="Abrir no dia ${dayNames[d.weekday].toLowerCase()}" data-weekday="${d.weekday}" data-field="enabled" ${d.enabled ? 'checked' : ''}>${dayNames[d.weekday]}</label><span>${d.enabled ? 'Aberto' : 'Fechado'}</span></legend>${d.enabled ? `<div class="time-pair">${timeField(`Abertura de ${dayNames[d.weekday].toLowerCase()}`, d.opensAt, `data-weekday="${d.weekday}" data-field="opensAt"`)}${timeField(`Fechamento de ${dayNames[d.weekday].toLowerCase()}`, d.closesAt, `data-weekday="${d.weekday}" data-field="closesAt"`)}</div>${pausesFields(d.breaks, d.weekday)}<button type="button" class="text-button" data-add-pause="${d.weekday}" ${d.breaks.length >= 8 ? 'disabled' : ''}>+ Adicionar pausa em ${dayNames[d.weekday].toLowerCase()}</button>` : '<p class="note">Sem atendimento no padrão semanal.</p>'}</fieldset>`).join('')}<p class="note">Horários em passos de 10 minutos. Fechamento 00:00 significa o fim do dia.</p><button class="primary">Revisar expediente <span aria-hidden="true">→</span></button></form></section>`;
  }
  function datesFields(prefix: string, from: string, to: string) {
    return `<div class="time-pair"><label>Data inicial ${prefix === 'special' ? 'do horário especial' : 'da faixa'}<input type="date" data-${prefix}="from" value="${from}" min="${o.localDate()}" max="${addDays(o.localDate(), 90)}" required></label><label>Data final ${prefix === 'special' ? 'do horário especial' : 'da faixa'}<input type="date" data-${prefix}="to" value="${to}" min="${from}" max="${addDays(o.localDate(), 90)}" required></label></div>`;
  }
  function specialForm() {
    return `<section class="settings-card"><span class="eyebrow">EXCEÇÕES AO PADRÃO</span><h2>Um dia ou um período diferente.</h2><p class="muted">O horário especial substitui o expediente e as pausas da semana nessas datas. Pode abrir no domingo. Fora do período, volta o padrão.</p><form id="special-schedule">${datesFields('special', special.from, special.to)}<label class="check-label"><input type="checkbox" data-special="closed" ${special.closed ? 'checked' : ''}>Fechado no período</label>${!special.closed ? `<div class="time-pair">${timeField('Abertura especial', special.opensAt, 'data-special="opensAt"')}${timeField('Fechamento especial', special.closesAt, 'data-special="closesAt"')}</div>${pausesFields(special.breaks)}<button type="button" class="text-button" data-action="add-special-pause" ${special.breaks.length >= 8 ? 'disabled' : ''}>+ Adicionar pausa especial</button>` : ''}<button class="primary">Revisar horário especial <span aria-hidden="true">→</span></button></form></section><section class="settings-card"><h3>Horários especiais cadastrados</h3><p class="note">Quando períodos se cruzam, vale o mais curto. Em períodos de mesma duração, vale o criado por último.</p>${cfg!.specials.length ? cfg!.specials.map((s) => `<article class="saved-rule"><strong>${e(o.dateLabel(s.from))}${s.from !== s.to ? ` até ${e(o.dateLabel(s.to))}` : ''}</strong><p>${s.closed ? 'Fechado' : `${inputTime(s.opensAt)}–${inputTime(s.closesAt)}${s.breaks.length ? ` · ${s.breaks.length} pausa(s)` : ''}`}</p><button class="text-button" data-remove-special="${s.id}">Remover horário especial</button></article>`).join('') : '<p class="muted">Nenhuma exceção cadastrada.</p>'}</section>`;
  }
  function ruleForm() {
    return `<section class="settings-card"><span class="eyebrow">QUEM PODE RESERVAR</span><h2>Controle cada faixa.</h2><p class="muted">Oculte só no link para manter os encaixes manuais, ou bloqueie a faixa nos dois canais.</p><form id="restriction-schedule">${datesFields('restriction', restriction.from, restriction.to)}<div class="time-pair">${timeField('Início da faixa', restriction.startsAt, 'data-restriction="startsAt"')}${timeField('Fim da faixa', restriction.endsAt, 'data-restriction="endsAt"')}</div><label>Disponibilidade da faixa<select data-restriction="scope"><option value="online" ${restriction.scope === 'online' ? 'selected' : ''}>Ocultar só no link</option><option value="all" ${restriction.scope === 'all' ? 'selected' : ''}>Bloquear link e hub</option></select></label><button class="primary">Revisar faixa <span aria-hidden="true">→</span></button></form></section><section class="settings-card"><h3>Faixas configuradas</h3>${cfg!.rules.length ? cfg!.rules.map((r) => `<article class="saved-rule"><span class="tag">${r.scope === 'online' ? 'OCULTA SÓ NO LINK' : 'BLOQUEIO NOS DOIS CANAIS'}</span><strong>${e(o.dateLabel(r.from))}${r.from !== r.to ? ` até ${e(o.dateLabel(r.to))}` : ''}</strong><p>${inputTime(r.startsAt)}–${inputTime(r.endsAt)}</p><button class="text-button" data-remove-rule="${r.id}">Reabrir faixa</button></article>`).join('') : '<p class="muted">Nenhuma faixa restrita.</p>'}</section>`;
  }
  function commandSummary(command: ScheduleCommand) {
    if (command.kind === 'weekly') return 'Atualizar expediente semanal e pausas.';
    if (command.kind === 'special')
      return `${command.closed ? 'Fechar' : 'Definir horário especial de ' + inputTime(command.opensAt) + ' a ' + inputTime(command.closesAt)}: ${o.dateLabel(command.from)} até ${o.dateLabel(command.to)}.`;
    if (command.kind === 'rule')
      return `${command.scope === 'online' ? 'Ocultar só no link' : 'Bloquear link e hub'}: ${o.dateLabel(command.from)} até ${o.dateLabel(command.to)}, ${inputTime(command.startsAt)}–${inputTime(command.endsAt)}.`;
    return command.kind === 'remove-rule'
      ? 'Remover a restrição e reabrir a faixa, respeitando expediente e reservas existentes.'
      : 'Remover o horário especial e voltar às demais regras para esse período.';
  }
  function renderSettings() {
    o.shell(
      `<section class="hub-heading"><div><span class="eyebrow">${e(o.shop().name)} / CONFIGURAÇÕES DE AGENDA</span><h1>Sua agenda.<br>Suas regras<span>.</span></h1><p class="muted">Ajuste a disponibilidade deste estabelecimento.<br>As reservas atuais continuam confirmadas.</p></div></section>${o.tabs()}<section class="settings-content">${errorBox()}${notice ? `<p class="success-note" role="status">${e(notice)}</p>` : ''}${loading ? '<p class="empty" role="status">Carregando configurações…</p>' : preview ? `<section class="settings-card preview-card"><span class="eyebrow">ANTES DE SALVAR</span><h2>Revise a alteração.</h2><p>${e(commandSummary(preview.command))}</p><h3>Reservas afetadas (${preview.affected.length})</h3>${affectedList(preview.affected)}<p class="preserve-note">Nenhuma reserva será cancelada ou remarcada automaticamente. Elas serão preservadas até você decidir o que fazer.</p><form id="save-schedule">${preview.affected.length ? '<label class="check-label"><input type="checkbox" required>Conferi as reservas afetadas e quero preservá-las.</label>' : ''}<div class="actions"><button type="button" class="text-button" data-action="edit-schedule">← Voltar à edição</button><button class="primary" ${busy ? 'disabled' : ''}>${busy ? 'Salvando…' : 'Salvar configuração'}</button></div></form></section>` : cfg ? `${cfg.affected.length ? `<section class="settings-card affected-card"><span class="eyebrow">RESERVAS PRECISAM DE ATENÇÃO</span><h2>${cfg.affected.length} reserva(s) fora da nova disponibilidade.</h2><p class="muted">Continuam confirmadas e ocupando a agenda. Remarque ou cancele cada uma quando decidir.</p>${affectedList(cfg.affected, true)}</section>` : ''}<nav class="settings-tabs" aria-label="Tipos de configuração"><button data-editor="weekly" aria-pressed="${editor === 'weekly'}">Semana</button><button data-editor="special" aria-pressed="${editor === 'special'}">Horários especiais</button><button data-editor="rules" aria-pressed="${editor === 'rules'}">Faixas e bloqueios</button></nav>${editor === 'weekly' ? weeklyForm() : editor === 'special' ? specialForm() : ruleForm()}` : ''}</section>`,
    );
  }
  function renderAction() {
    if (!detail) {
      o.shell(
        `<section class="login">${errorBox()}<p class="empty">Carregando reserva…</p></section>`,
      );
      return;
    }
    const a = detail.appointment;
    const title =
      view === 'reschedule'
        ? 'Um novo horário.'
        : view === 'cancel'
          ? 'Cancelar atendimento.'
          : 'Histórico da reserva.';
    o.shell(
      `<section class="hub-heading"><div><span class="eyebrow">${e(o.shop().name)} / ATENDIMENTO</span><h1>${title}</h1></div></section>${o.tabs()}<section class="appointment-detail">${errorBox()}<div class="settings-card"><span class="tag">${a.status === 'cancelled' ? 'CANCELADO' : 'CONFIRMADO'}</span><h2>${e(a.customer_name)}</h2><p>${e(a.service_name)} · ${e(a.price_label)} · ${a.duration_minutes} min</p><p><strong>${e(when(a.starts_at, a.ends_at))}</strong></p></div>${view === 'reschedule' && a.status === 'confirmed' ? `<section class="settings-card"><h2>Escolha o novo horário.</h2><p class="muted">O horário atual só será liberado depois que a remarcação for confirmada.</p><label>Nova data<input type="date" id="reschedule-date" value="${actionDate}" min="${o.localDate()}" max="${addDays(o.localDate(), 90)}" ${loading || busy ? 'disabled' : ''}></label>${loading ? '<p class="empty" role="status">Consultando horários…</p>' : slots.length ? `<div class="times reschedule-times">${slots.map((s) => `<button type="button" class="time ${newStart === s ? 'selected' : ''}" data-reschedule-time="${s}" ${s === a.starts_at ? 'disabled aria-label="Horário atual"' : ''} aria-pressed="${newStart === s}">${o.timeLabel(s)}</button>`).join('')}</div>` : '<p class="empty">Nenhum horário disponível. Escolha outra data.</p>'}${newStart ? `<div class="review"><h3>Confira antes de confirmar</h3><p>Atual: ${e(when(a.starts_at, a.ends_at))}</p><p>Novo: <strong>${e(when(newStart, newStart + a.duration_minutes * 60))}</strong></p></div>` : ''}<form id="reschedule-booking"><button class="primary" ${!newStart || busy || loading ? 'disabled' : ''}>${busy ? 'Confirmando…' : 'Confirmar remarcação'}</button></form></section>` : view === 'cancel' && a.status === 'confirmed' ? `<section class="settings-card"><h2>Confirmar cancelamento</h2><p>O horário será liberado, e o atendimento continuará no histórico como cancelado.</p><form id="cancel-booking"><button class="primary danger-button" ${busy ? 'disabled' : ''}>${busy ? 'Cancelando…' : 'Confirmar cancelamento'}</button></form></section>` : ''}<section class="settings-card"><h3>Histórico de alterações</h3><ol class="booking-timeline">${detail.events.map((event) => `<li><strong>${event.kind === 'created' ? 'Reserva criada' : event.kind === 'rescheduled' ? 'Remarcado' : 'Cancelado'}</strong><p>${event.kind === 'rescheduled' && event.old_start !== null ? `${e(when(event.old_start, event.old_end!))} → ` : ''}${e(when(event.new_start, event.new_end))}</p></li>`).join('')}</ol><p class="note">O WhatsApp ainda não envia mensagens nesta etapa.</p></section><button class="text-button" data-action="close-appointment">← ${returnToSettings ? 'Voltar às configurações' : 'Voltar à agenda'}</button></section>`,
    );
  }
  async function refreshConfig(resetDraft = true) {
    const result = await o.api<ScheduleView>('/api/admin/schedule');
    cfg = result;
    o.onConfig(result);
    if (resetDraft) weekly = structuredClone(result.days);
  }
  async function openSettings() {
    view = 'settings';
    o.setSettings();
    loading = true;
    error = '';
    notice = '';
    preview = null;
    o.render();
    try {
      await refreshConfig();
    } catch (err) {
      fail(err);
    } finally {
      loading = false;
      o.render();
    }
  }
  async function loadActionSlots() {
    if (!detail) return;
    loading = true;
    newStart = 0;
    o.render();
    try {
      slots = (
        await o.api<{ slots: number[] }>(
          `/api/admin/availability?date=${actionDate}&appointmentId=${encodeURIComponent(detail.appointment.id)}`,
        )
      ).slots;
    } catch (err) {
      fail(err);
    } finally {
      loading = false;
      o.render();
    }
  }
  async function openAppointment(id: string, kind: 'reschedule' | 'cancel' | 'history') {
    returnToSettings = view === 'settings';
    view = kind;
    detail = null;
    error = '';
    notice = '';
    loading = true;
    actionKey = crypto.randomUUID();
    o.render();
    try {
      detail = await o.api<AppointmentDetail>(`/api/admin/bookings/${encodeURIComponent(id)}`);
      actionDate = dateOf(detail.appointment.starts_at);
      if (actionDate < o.localDate()) actionDate = o.localDate();
      if (kind === 'reschedule' && detail.appointment.status === 'confirmed')
        await loadActionSlots();
    } catch (err) {
      fail(err);
    } finally {
      loading = false;
      o.render();
    }
  }
  async function makePreview(command: ScheduleCommand) {
    if (!cfg) return;
    busy = true;
    error = '';
    notice = '';
    o.render();
    try {
      preview = await o.api<SchedulePreview>('/api/admin/schedule/preview', {
        command,
        expectedRevision: cfg.revision,
      });
    } catch (err) {
      fail(err);
      if ((err as { status?: number }).status === 409) await refreshConfig(false);
    } finally {
      busy = false;
      o.render();
      if (preview) document.querySelector('.preview-card')?.scrollIntoView({ block: 'start' });
    }
  }
  async function finishAction(kind: 'reschedule' | 'cancel') {
    if (!detail) return;
    busy = true;
    error = '';
    o.render();
    try {
      const result = await o.api<{ appointment: AppointmentDetail['appointment'] }>(
        `/api/admin/bookings/${detail.appointment.id}/${kind}`,
        {
          expectedVersion: detail.appointment.version,
          requestKey: actionKey,
          ...(kind === 'reschedule' ? { startsAt: newStart } : {}),
        },
      );
      const message =
        kind === 'reschedule'
          ? 'Reserva remarcada. O horário anterior foi liberado.'
          : 'Reserva cancelada. O horário foi liberado e o histórico foi preservado.';
      if (returnToSettings) {
        view = 'settings';
        notice = message;
        await refreshConfig();
      } else {
        view = null;
        await o.onDone(message, dateOf(result.appointment.starts_at));
      }
    } catch (err) {
      fail(err);
      if ((err as { status?: number }).status === 409) {
        detail = await o.api<AppointmentDetail>(`/api/admin/bookings/${detail.appointment.id}`);
        actionKey = crypto.randomUUID();
        if (kind === 'reschedule' && detail.appointment.status === 'confirmed')
          await loadActionSlots();
      }
    } finally {
      busy = false;
      o.render();
    }
  }
  return {
    active: () => view !== null,
    get busy() {
      return busy;
    },
    close: () => {
      view = null;
      preview = null;
      detail = null;
      error = '';
      notice = '';
    },
    openSettings,
    render: () => (view === 'settings' ? renderSettings() : renderAction()),
    async click(button: HTMLButtonElement): Promise<boolean> {
      if (!view && !button.dataset.reschedule && !button.dataset.cancel && !button.dataset.history)
        return false;
      if (busy) return true;
      if (button.dataset.reschedule || button.dataset.cancel || button.dataset.history) {
        await openAppointment(
          (button.dataset.reschedule || button.dataset.cancel || button.dataset.history)!,
          button.dataset.reschedule ? 'reschedule' : button.dataset.cancel ? 'cancel' : 'history',
        );
        return true;
      }
      if (button.dataset.editor) {
        editor = button.dataset.editor as typeof editor;
        error = '';
        preview = null;
        o.render();
        return true;
      }
      if (button.dataset.addPause !== undefined) {
        weekly[Number(button.dataset.addPause)].breaks.push({ startsAt: 720, endsAt: 780 });
        o.render();
        return true;
      }
      if (button.dataset.removePause !== undefined) {
        weekly[Number(button.dataset.day)].breaks.splice(Number(button.dataset.removePause), 1);
        o.render();
        return true;
      }
      if (button.dataset.removeSpecialPause !== undefined) {
        special.breaks.splice(Number(button.dataset.removeSpecialPause), 1);
        o.render();
        return true;
      }
      if (button.dataset.removeSpecial || button.dataset.removeRule) {
        await makePreview({
          kind: button.dataset.removeSpecial ? 'remove-special' : 'remove-rule',
          id: Number(button.dataset.removeSpecial || button.dataset.removeRule),
        });
        return true;
      }
      if (button.dataset.rescheduleTime) {
        newStart = Number(button.dataset.rescheduleTime);
        actionKey = crypto.randomUUID();
        o.render();
        return true;
      }
      switch (button.dataset.action) {
        case 'add-special-pause':
          special.breaks.push({ startsAt: 720, endsAt: 780 });
          o.render();
          return true;
        case 'edit-schedule':
          preview = null;
          o.render();
          return true;
        case 'close-appointment':
          if (returnToSettings) await openSettings();
          else {
            view = null;
            await o.onDone('', detail ? dateOf(detail.appointment.starts_at) : o.localDate());
          }
          return true;
      }
      return false;
    },
    input(input: HTMLInputElement | HTMLSelectElement): boolean {
      if (input.dataset.weekday !== undefined) {
        const day = weekly[Number(input.dataset.weekday)],
          field = input.dataset.field!;
        if (field === 'enabled') {
          day.enabled = (input as HTMLInputElement).checked;
          o.render();
        } else if (input.dataset.pause !== undefined) {
          day.breaks[Number(input.dataset.pause)][field as keyof Pause] = minutes(
            input.value,
            field === 'endsAt',
          );
        } else day[field as 'opensAt' | 'closesAt'] = minutes(input.value, field === 'closesAt');
        return true;
      }
      if (input.dataset.specialPause !== undefined) {
        special.breaks[Number(input.dataset.specialPause)][input.dataset.field as keyof Pause] =
          minutes(input.value, input.dataset.field === 'endsAt');
        return true;
      }
      if (input.dataset.special) {
        const field = input.dataset.special;
        if (field === 'closed') {
          special.closed = (input as HTMLInputElement).checked;
          o.render();
        } else if (field === 'from' || field === 'to') {
          special[field] = input.value;
          if (special.to < special.from) special.to = special.from;
          const to = document.querySelector<HTMLInputElement>('[data-special="to"]');
          if (to) {
            to.value = special.to;
            to.min = special.from;
          }
        } else
          special[field as 'opensAt' | 'closesAt'] = minutes(input.value, field === 'closesAt');
        return true;
      }
      if (input.dataset.restriction) {
        const field = input.dataset.restriction;
        if (field === 'scope') restriction.scope = input.value as 'online' | 'all';
        else if (field === 'from' || field === 'to') {
          restriction[field] = input.value;
          if (restriction.to < restriction.from) restriction.to = restriction.from;
          const to = document.querySelector<HTMLInputElement>('[data-restriction="to"]');
          if (to) {
            to.value = restriction.to;
            to.min = restriction.from;
          }
        } else
          restriction[field as 'startsAt' | 'endsAt'] = minutes(input.value, field === 'endsAt');
        return true;
      }
      return false;
    },
    async change(input: HTMLInputElement | HTMLSelectElement): Promise<boolean> {
      if (input.id === 'reschedule-date' && input.value) {
        actionDate = input.value;
        actionKey = crypto.randomUUID();
        await loadActionSlots();
        return true;
      }
      return false;
    },
    async submit(form: HTMLFormElement): Promise<boolean> {
      if (form.id === 'weekly-schedule') {
        await makePreview({ kind: 'weekly', days: structuredClone(weekly) });
        return true;
      }
      if (form.id === 'special-schedule') {
        await makePreview({ kind: 'special', ...structuredClone(special) });
        return true;
      }
      if (form.id === 'restriction-schedule') {
        await makePreview({ kind: 'rule', ...restriction });
        return true;
      }
      if (form.id === 'save-schedule' && preview) {
        busy = true;
        error = '';
        o.render();
        try {
          cfg = await o.api<ScheduleView>('/api/admin/schedule/save', {
            command: preview.command,
            expectedRevision: preview.revision,
            previewToken: preview.previewToken,
          });
          o.onConfig(cfg);
          weekly = structuredClone(cfg.days);
          preview = null;
          notice = 'Configuração salva. As reservas existentes foram preservadas.';
        } catch (err) {
          fail(err);
          if ((err as { status?: number }).status === 409) {
            preview = null;
            await refreshConfig(false);
          }
        } finally {
          busy = false;
          o.render();
          document.querySelector('.settings-content')?.scrollIntoView({ block: 'start' });
        }
        return true;
      }
      if (form.id === 'reschedule-booking') {
        await finishAction('reschedule');
        return true;
      }
      if (form.id === 'cancel-booking') {
        await finishAction('cancel');
        return true;
      }
      return false;
    },
  };
}
