import type { ManagedService, Service } from '../shared';
export function createServiceManagement(o: {
  api: <T>(path: string, data?: unknown) => Promise<T>;
  shell: (html: string) => void;
  tabs: () => string;
  escape: (v: unknown) => string;
  prepare: () => void;
  render: () => void;
  onError: (e: unknown) => void;
  onSaved: (services: Service[]) => void;
}) {
  let open = false,
    busy = false,
    rows: ManagedService[] = [],
    editing: ManagedService | undefined,
    draft: ManagedService | undefined,
    error = '',
    notice = '',
    epoch = 0;
  const e = o.escape;
  const fresh = (): ManagedService => ({
    id: '',
    name: '',
    price: '',
    duration: 30,
    description: '',
    paymentConditions: '',
    active: true,
    version: 0,
  });
  function render() {
    o.shell(
      `<section class="hub-heading"><div><h1>Seus serviços.</h1><p class="muted">Preços e durações para os próximos agendamentos.</p></div></section>${o.tabs()}<section class="agenda service-settings">${error ? `<p role="alert" class="error">${e(error)}</p>` : ''}${notice ? `<p role="status" class="success-note">${e(notice)}</p>` : ''}<p class="preserve-note">Reservas já feitas mantêm nome, duração, horário e condições combinadas, inclusive ao remarcar. Desativar um serviço impede novas reservas; o histórico continua disponível.</p>${draft ? `<form id="service-editor" class="settings-card"><h2>${editing ? 'Editar serviço' : 'Novo serviço'}</h2><label>Nome do serviço<input name="name" required maxlength="100" value="${e(draft.name)}"></label><label>Duração em minutos<input name="duration" type="number" required min="10" max="240" step="10" value="${draft.duration}"></label><label>Preço exibido<input name="price" required maxlength="200" placeholder="R$ 30,00 ou A partir de R$ 60,00" value="${e(draft.price)}"></label><label>Condições de pagamento<textarea name="paymentConditions" maxlength="300" placeholder="Ex.: Pix ou dinheiro; no cartão R$ 33,00">${e(draft.paymentConditions)}</textarea></label><label>Descrição<textarea name="description" maxlength="300">${e(draft.description)}</textarea></label><label class="check-label"><input type="checkbox" name="active" ${draft.active ? 'checked' : ''}>Ativo para novos agendamentos</label><div class="actions"><button class="primary" ${busy ? 'disabled' : ''}>${busy ? 'Salvando…' : 'Salvar serviço'}</button><button type="button" class="text-button" data-service-settings="back" ${busy ? 'disabled' : ''}>Voltar aos serviços</button></div></form>` : `<button class="primary" data-service-settings="add" ${busy ? 'disabled' : ''}>+ Novo serviço</button><ul class="customers">${rows.map((s) => `<li><h2>${e(s.name)}</h2><p>${e(s.price)}${s.paymentConditions ? ` · ${e(s.paymentConditions)}` : ''} · ${s.duration} min</p><p>${s.active ? 'Ativo' : 'Desativado'}</p><button class="text-button" data-edit-service="${e(s.id)}" ${busy ? 'disabled' : ''}>Editar ${e(s.name)}</button></li>`).join('')}</ul>`}</section>`,
    );
  }
  async function load() {
    open = true;
    o.prepare();
    busy = true;
    draft = undefined;
    error = '';
    notice = '';
    o.render();
    const request = ++epoch;
    try {
      const result = await o.api<{ services: ManagedService[] }>('/api/admin/services');
      if (request === epoch) rows = result.services;
    } catch (err) {
      o.onError(err);
      error = err instanceof Error ? err.message : 'Não foi possível carregar os serviços.';
    } finally {
      if (request === epoch) {
        busy = false;
        o.render();
      }
    }
  }
  function close() {
    open = false;
    draft = undefined;
    busy = false;
    epoch++;
  }
  async function click(b: HTMLButtonElement) {
    if (b.dataset.action === 'manage-services') {
      await load();
      return true;
    }
    if (!open) return false;
    if (b.dataset.editService) {
      editing = rows.find((s) => s.id === b.dataset.editService);
      draft = editing ? { ...editing } : undefined;
      error = '';
      notice = '';
      o.render();
      return true;
    }
    if (b.dataset.serviceSettings) {
      editing = undefined;
      draft = b.dataset.serviceSettings === 'add' ? fresh() : undefined;
      error = '';
      o.render();
      return true;
    }
    if (b.dataset.action) {
      close();
      return false;
    }
    return false;
  }
  async function submit(form: HTMLFormElement) {
    if (form.id !== 'service-editor' || !draft) return false;
    const data = new FormData(form);
    draft = {
      ...draft,
      name: String(data.get('name')),
      price: String(data.get('price')),
      duration: Number(data.get('duration')),
      paymentConditions: String(data.get('paymentConditions')),
      description: String(data.get('description')),
      active: data.has('active'),
    };
    busy = true;
    error = '';
    o.render();
    try {
      await o.api('/api/admin/services' + (editing ? `/${encodeURIComponent(editing.id)}` : ''), {
        ...draft,
        expectedVersion: editing?.version,
      });
      rows = (await o.api<{ services: ManagedService[] }>('/api/admin/services')).services;
      const catalog = await o.api<{ services: Service[] }>('/api/services');
      o.onSaved(catalog.services);
      draft = undefined;
      notice =
        'Serviço salvo. A página pública já usa a nova configuração. Reservas anteriores foram preservadas.';
    } catch (err) {
      o.onError(err);
      error = err instanceof Error ? err.message : 'Não foi possível salvar.';
    } finally {
      busy = false;
      o.render();
    }
    return true;
  }
  return {
    render,
    click,
    submit,
    close,
    active: () => open,
    get busy() {
      return busy;
    },
  };
}
