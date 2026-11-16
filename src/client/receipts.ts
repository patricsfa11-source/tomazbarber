import type { AppointmentRecord } from '../calendar';
import { localDate, type Shop } from '../shared';
import {
  money,
  moneyInput,
  parseMoney,
  suggestedAmount,
  paymentMethods,
  type PaymentMethod,
  type ReceiptRecord,
  type ReceiptReport,
  type ReceiptGroup,
} from '../finance';
interface Options {
  api: <T>(path: string, data?: unknown) => Promise<T>;
  shell: (html: string) => void;
  tabs: () => string;
  escape: (value: unknown) => string;
  shop: () => Shop;
  onError: (error: unknown) => void;
  onDone: (message: string) => Promise<void>;
  prepare: () => void;
}
export function createReceipts(o: Options) {
  let view: 'complete' | 'payment' | 'reports' | null = null;
  let appointment: AppointmentRecord | null = null,
    receipt: ReceiptRecord | null = null,
    report: ReceiptReport | null = null;
  let loading = false,
    busy = false,
    error = '',
    notice = '',
    amount = '',
    paidOn = '',
    method: PaymentMethod = 'pix';
  let from = '',
    to = '',
    group: 'clients' | 'services' | 'methods' = 'clients',
    key = crypto.randomUUID() as string,
    epoch = 0;
  const e = o.escape,
    today = () => localDate(new Date(), o.shop().timezone);
  const date = (d: string) => d.split('-').reverse().join('/');
  const base = () => `/api/admin/bookings/${appointment!.id}`;
  function fail(cause: unknown) {
    error = cause instanceof Error ? cause.message : 'Não foi possível concluir.';
    o.onError(cause);
  }
  function renderGroups(rows: ReceiptGroup[]) {
    return rows.length
      ? `<ul class="receipt-groups">${rows.map((r) => `<li><div><strong>${e(group === 'methods' ? paymentMethods[r.id as PaymentMethod] : r.name)}</strong><small>${r.count} recebimento${r.count === 1 ? '' : 's'}</small></div><strong>${money(r.total_cents)}</strong></li>`).join('')}</ul>`
      : '<p class="empty">Nenhum recebimento neste período.</p>';
  }
  function render() {
    if (!view) return;
    let content = '';
    if (loading && !report && !appointment)
      content = '<p class="empty" role="status">Consultando…</p>';
    else if (view === 'reports')
      content = `${report ? `<div class="cash-summary"><section><span>Recebido hoje</span><strong>${money(report.today_cents)}</strong><small>${date(report.today)}</small></section><section><span>Recebido no mês</span><strong>${money(report.month_cents)}</strong><small>Mês atual · pela data do pagamento</small></section></div>` : ''}
      <section class="settings-card"><h2>Consultar período</h2><form id="receipt-period"><div class="receipt-period"><label for="receipt-from">De<input id="receipt-from" type="date" value="${from}" min="2000-01-01" max="${today()}" required></label><label for="receipt-to">Até<input id="receipt-to" type="date" value="${to}" min="2000-01-01" max="${today()}" required></label></div><button class="primary" ${loading ? 'disabled' : ''}>${loading ? 'Consultando…' : 'Aplicar período'}</button></form><p class="note">Até 366 dias. O caixa considera a data do pagamento, independentemente da data ou situação do atendimento.</p></section>
      ${report ? `<section class="settings-card"><span class="eyebrow">${date(report.from)} a ${date(report.to)}</span><h2>Total do período</h2><p class="cash-total">${money(report.total_cents)}</p><p class="muted">${report.count} recebimento${report.count === 1 ? '' : 's'} registrado${report.count === 1 ? '' : 's'}</p><nav class="receipt-tabs" aria-label="Agrupar relatório">${(['clients', 'services', 'methods'] as const).map((g) => `<button class="text-button" data-receipt-group="${g}" aria-pressed="${group === g}">${g === 'clients' ? 'Por cliente' : g === 'services' ? 'Por serviço' : 'Por pagamento'}</button>`).join('')}</nav>${renderGroups(report[group])}</section><section class="settings-card"><h2>Recebimentos registrados</h2>${report.receipts.length ? `<ul class="receipt-list">${report.receipts.map((r) => `<li><div><strong>${e(r.customer_name)}</strong><span>${e(r.service_name)}</span><small>${date(r.paid_on)} · ${paymentMethods[r.method]}</small></div><strong>${money(r.amount_cents)}</strong></li>`).join('')}</ul>` : '<p class="empty">O primeiro recebimento aparecerá aqui.</p>'}${report.nextCursor ? `<button class="primary" data-receipt-action="more" ${loading ? 'disabled' : ''}>Carregar mais recebimentos</button>` : ''}</section>` : ''}`;
    else if (appointment) {
      const a = appointment;
      content = `<section class="settings-card receipt-appointment"><span class="eyebrow">${e(a.service_name)}</span><h2>${e(a.customer_name)}</h2><p class="muted">${date(localDate(new Date(a.starts_at * 1000), o.shop().timezone))} · ${e(a.price_label)}</p>`;
      if (view === 'complete')
        content += `<p>Marcar como concluído registra que o atendimento foi realizado. O recebimento é registrado separadamente.</p><p class="note">O horário permanece no histórico e não poderá ser remarcado ou cancelado depois de concluído.</p><div class="actions"><button class="text-button" data-receipt-action="back" ${busy ? 'disabled' : ''}>Voltar à agenda</button><button class="primary" data-receipt-action="confirm-complete" ${busy ? 'disabled' : ''}>${busy ? 'Concluindo…' : 'Confirmar conclusão'}</button></div>`;
      else if (receipt)
        content += `<p class="success-note">Recebimento registrado</p><p class="cash-total">${money(receipt.amount_cents)}</p><p>${date(receipt.paid_on)} · ${paymentMethods[receipt.method]}</p><p class="note">Este atendimento já tem um recebimento registrado. Nenhum valor será duplicado.</p><button class="primary" data-receipt-action="reports">Ver resumo do mês</button><button class="text-button" data-receipt-action="back">Voltar à agenda</button>`;
      else
        content += `<form id="receipt-payment"><label for="payment-method">Forma de pagamento</label><select id="payment-method">${Object.entries(
          paymentMethods,
        )
          .map(
            ([value, label]) =>
              `<option value="${value}" ${method === value ? 'selected' : ''}>${label}</option>`,
          )
          .join(
            '',
          )}</select><label for="payment-amount">Valor recebido (R$)<input id="payment-amount" inputmode="decimal" value="${e(amount)}" placeholder="0,00" maxlength="9" required></label><p class="note">O preço do serviço é uma sugestão. Ajuste para o valor efetivamente recebido.</p><label for="payment-date">Data do pagamento<input id="payment-date" type="date" value="${paidOn}" min="2000-01-01" max="${today()}" required></label><p class="note">Registrar pagamento não conclui o atendimento e não envia mensagens. A taxa de falta é combinada e recebida presencialmente; nenhum valor é lançado automaticamente.</p><div class="actions"><button type="button" class="text-button" data-receipt-action="back" ${busy ? 'disabled' : ''}>Voltar</button><button class="primary" ${busy ? 'disabled' : ''}>${busy ? 'Salvando…' : 'Salvar recebimento'}</button></div></form>`;
      content += '</section>';
    }
    o.shell(
      `<section class="hub-heading"><div><span class="eyebrow">${e(o.shop().name)} / CAIXA</span><h1>${view === 'reports' ? 'Recebimentos e relatórios' : view === 'complete' ? 'Concluir atendimento' : 'Registrar pagamento'}<span>.</span></h1><p class="muted">${view === 'reports' ? 'O que entrou, no dia em que você recebeu.' : 'Atendimento e pagamento, cada um no seu momento.'}</p></div><button class="text-button" data-action="logout" ${busy ? 'disabled' : ''}>Sair do hub →</button></section>${o.tabs()}<div class="receipts-layout"><div class="error" role="alert" ${error ? '' : 'hidden'}>${e(error)}</div>${notice ? `<p class="success-note" role="status">${e(notice)}</p>` : ''}${content}</div>`,
    );
  }
  async function loadReport(more = false) {
    const request = ++epoch;
    loading = true;
    error = '';
    render();
    try {
      const data = await o.api<ReceiptReport>(
        `/api/admin/receipts?from=${more && report ? report.from : from}&to=${more && report ? report.to : to}${more && report?.nextCursor ? `&cursor=${encodeURIComponent(report.nextCursor)}` : ''}`,
      );
      if (request === epoch)
        report =
          more && report ? { ...data, receipts: [...report.receipts, ...data.receipts] } : data;
    } catch (cause) {
      if (request === epoch) fail(cause);
    } finally {
      if (request === epoch) {
        loading = false;
        render();
      }
    }
  }
  async function openReports() {
    o.prepare();
    view = 'reports';
    appointment = null;
    receipt = null;
    report = null;
    from = `${today().slice(0, 7)}-01`;
    to = today();
    notice = '';
    await loadReport();
  }
  return {
    active: () => view !== null,
    isReport: () => view === 'reports',
    get busy() {
      return busy;
    },
    close() {
      epoch++;
      view = null;
      appointment = null;
      receipt = null;
      report = null;
      loading = false;
      error = '';
      notice = '';
    },
    render,
    async click(button: HTMLButtonElement) {
      if (button.dataset.action === 'receipts' || button.dataset.receiptAction === 'reports') {
        await openReports();
        return true;
      }
      if (button.dataset.complete || button.dataset.payment) {
        o.prepare();
        const request = ++epoch;
        view = button.dataset.complete ? 'complete' : 'payment';
        appointment = null;
        receipt = null;
        report = null;
        error = '';
        notice = '';
        loading = true;
        key = crypto.randomUUID();
        render();
        try {
          const data = await o.api<{
            appointment: AppointmentRecord;
            receipt: ReceiptRecord | null;
          }>(`/api/admin/bookings/${button.dataset.complete || button.dataset.payment}/payment`);
          if (request === epoch) {
            appointment = data.appointment;
            receipt = data.receipt;
            method = 'pix';
            amount = moneyInput(suggestedAmount(appointment.price_label, method) || 0);
            paidOn = today();
          }
        } catch (cause) {
          if (request === epoch) fail(cause);
        } finally {
          if (request === epoch) {
            loading = false;
            render();
          }
        }
        return true;
      }
      if (button.dataset.receiptGroup && report) {
        group = button.dataset.receiptGroup as typeof group;
        render();
        return true;
      }
      if (button.dataset.receiptAction === 'more') {
        if (!loading) await loadReport(true);
        return true;
      }
      if (button.dataset.receiptAction === 'back') {
        await o.onDone('');
        return true;
      }
      if (button.dataset.receiptAction === 'confirm-complete' && appointment) {
        busy = true;
        error = '';
        render();
        try {
          await o.api(`${base()}/complete`, {
            requestKey: key,
            expectedVersion: appointment.version,
          });
          await o.onDone('Atendimento concluído. O pagamento pode ser registrado separadamente.');
        } catch (cause) {
          fail(cause);
        } finally {
          busy = false;
          render();
        }
        return true;
      }
      return false;
    },
    input(input: HTMLInputElement) {
      if (input.id === 'payment-amount') {
        amount = input.value;
        key = crypto.randomUUID();
        return true;
      }
      if (input.id === 'payment-date') {
        paidOn = input.value;
        key = crypto.randomUUID();
        return true;
      }
      if (input.id === 'receipt-from' || input.id === 'receipt-to') {
        if (input.id === 'receipt-from') from = input.value;
        else to = input.value;
        return true;
      }
      return false;
    },
    change(input: HTMLInputElement) {
      if (input.id !== 'payment-method') return false;
      const previous = suggestedAmount(appointment!.price_label, method);
      method = input.value as PaymentMethod;
      if (parseMoney(amount) === previous)
        amount = moneyInput(suggestedAmount(appointment!.price_label, method) || 0);
      key = crypto.randomUUID();
      render();
      return true;
    },
    async submit(form: HTMLFormElement) {
      if (form.id === 'receipt-period') {
        report = null;
        await loadReport();
        return true;
      }
      if (form.id !== 'receipt-payment' || !appointment) return false;
      const amountCents = parseMoney(amount);
      if (amountCents === null) {
        error = 'Informe um valor válido, como 30,00, com no máximo duas casas decimais.';
        render();
        return true;
      }
      busy = true;
      error = '';
      render();
      try {
        const result = await o.api<{ receipt: ReceiptRecord }>(`${base()}/payment`, {
          requestKey: key,
          amountCents,
          paidOn,
          method,
        });
        receipt = result.receipt;
        notice = 'Pagamento registrado no caixa.';
      } catch (cause) {
        fail(cause);
      } finally {
        busy = false;
        render();
      }
      return true;
    },
  };
}
