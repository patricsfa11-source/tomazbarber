import QRCode from 'qrcode';
import type { Shop } from '../shared';
import { copyText } from './clipboard';
interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}
let installPrompt: InstallPrompt | null = null;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event as InstallPrompt;
});
export function createHubTools(o: {
  shop: () => Shop | null;
  publicPath: string;
  escape: (value: unknown) => string;
  isLoggedIn: () => boolean;
}) {
  let panel: 'install' | 'share' | null = null,
    qrReady = false,
    qrEpoch = 0;
  const installed = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  const link = () => new URL(o.publicPath, location.origin).href;
  function network() {
    document.querySelectorAll<HTMLElement>('[data-network-note]').forEach((n) => {
      n.hidden = navigator.onLine;
    });
  }
  window.addEventListener('offline', network);
  window.addEventListener('online', network);
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    document
      .querySelectorAll('[data-hub-tool="install"]')
      .forEach((b) => (b.textContent = 'Hub instalado'));
  });
  function render() {
    const shop = o.shop();
    if (!shop) return '';
    const ios =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return `<div class="hub-utilities"><button class="text-button" data-hub-tool="install">${installed() ? 'Hub instalado' : 'Instalar hub'}</button>${o.isLoggedIn() ? '<button class="text-button" data-hub-tool="share">Divulgar agendamento ↗</button>' : ''}</div><p class="network-note" data-network-note role="status" ${navigator.onLine ? 'hidden' : ''}>Sem conexão. A agenda na tela pode estar desatualizada. Reconecte antes de registrar ou alterar reservas.</p>
    <dialog id="hub-tool-dialog" class="hub-tool-dialog" aria-labelledby="hub-tool-title"><div class="dialog-heading"><h2 id="hub-tool-title">${panel === 'share' ? 'Seu link, pronto para divulgar.' : 'Sua agenda na tela inicial.'}</h2><button class="text-button" data-hub-tool="close" aria-label="Fechar">×</button></div>${panel === 'share' ? `<p class="muted">${o.escape(shop.name)} · Agendamento pelo navegador.</p><label>Link de agendamento<input id="shop-booking-link" value="${o.escape(link())}" readonly></label><button class="primary" data-hub-tool="copy">Copiar link de agendamento</button><a class="share-whatsapp" href="https://wa.me/?text=${encodeURIComponent(`${shop.name} · Agende seu horário: ${link()}`)}" target="_blank" rel="noopener noreferrer">Compartilhar pelo WhatsApp ↗</a><p class="note">Você escolhe o destinatário e confirma o envio no WhatsApp.</p><div class="qr-card"><canvas id="booking-qr" aria-label="QR Code do agendamento de ${o.escape(shop.name)}" role="img"></canvas></div><p class="note">O QR Code abre o mesmo link público de agendamento.</p><button class="primary" data-hub-tool="download" disabled>Baixar QR Code em PNG</button>` : `<p class="muted">Abra o hub pelo ícone do celular. Seu acesso continua protegido pela senha do estabelecimento.</p>${installed() ? '<p class="success-note">Este hub já está aberto como aplicativo.</p>' : `<ol class="install-steps">${ios ? '<li>Abra este hub no Safari.</li><li>Toque em Compartilhar.</li><li>Escolha Adicionar à Tela de Início e confirme em Adicionar. Se aparecer, mantenha Abrir como App ativado.</li>' : '<li>Abra este hub no Chrome.</li><li>Use o botão abaixo quando disponível ou o menu ⋮ do navegador.</li><li>Escolha Instalar app ou Adicionar à tela inicial.</li>'}</ol>${installPrompt ? '<button class="primary" data-hub-tool="prompt">Instalar neste aparelho</button>' : ''}`}<p class="note">É preciso conexão para consultar ou alterar a agenda. Cada estabelecimento tem seu próprio ícone e acesso.</p>`}<p class="tool-notice" role="status" data-tool-notice></p></dialog>`;
  }
  function notice(message: string) {
    const el = document.querySelector('[data-tool-notice]');
    if (el) el.textContent = message;
  }
  function afterRender() {
    network();
    const dialog = document.querySelector<HTMLDialogElement>('#hub-tool-dialog');
    if (!dialog) return;
    dialog.addEventListener('close', () => {
      panel = null;
      qrEpoch++;
    });
    if (panel && !dialog.open) dialog.showModal();
    if (panel === 'share') {
      const epoch = ++qrEpoch,
        canvas = document.querySelector<HTMLCanvasElement>('#booking-qr');
      qrReady = false;
      if (canvas)
        void QRCode.toCanvas(canvas, link(), {
          width: 512,
          margin: 4,
          errorCorrectionLevel: 'M',
          color: { dark: '#000000', light: '#ffffff' },
        })
          .then(() => {
            if (epoch !== qrEpoch) return;
            qrReady = true;
            const b = document.querySelector<HTMLButtonElement>('[data-hub-tool="download"]');
            if (b) b.disabled = false;
          })
          .catch(() => notice('Não foi possível criar o QR Code. Copie o link acima.'));
    }
  }
  return {
    render,
    afterRender,
    async start() {
      const shop = o.shop();
      if (!shop) return;
      const manifest = document.createElement('link');
      manifest.rel = 'manifest';
      manifest.href = `${o.publicPath}/hub.webmanifest`;
      document.head.appendChild(manifest);
      const icon = document.createElement('link');
      icon.rel = 'apple-touch-icon';
      icon.href = `/icons/${shop.logoUrl ? 'tomaz-barber' : 'salao-aurora'}-192.png`;
      document.head.appendChild(icon);
      if ('serviceWorker' in navigator && window.isSecureContext)
        try {
          await navigator.serviceWorker.register('/hub-sw.js', {
            scope: `${o.publicPath}/`,
            updateViaCache: 'none',
          });
        } catch {
          /* A agenda permanece disponível mesmo sem suporte à instalação. */
        }
    },
    async click(button: HTMLButtonElement, rerender: () => void) {
      const action = button.dataset.hubTool;
      if (!action) return false;
      if (action === 'install' || action === 'share') {
        if (action === 'share' && !o.isLoggedIn()) return true;
        panel = action;
        rerender();
        return true;
      }
      if (action === 'close') {
        document.querySelector<HTMLDialogElement>('#hub-tool-dialog')?.close();
        return true;
      }
      try {
        if (action === 'copy') {
          await copyText(link());
          notice('Link de agendamento copiado.');
        }
        if (action === 'prompt' && installPrompt) {
          const event = installPrompt;
          installPrompt = null;
          await event.prompt();
          const result = await event.userChoice;
          notice(
            result.outcome === 'accepted'
              ? 'Instalação solicitada. Abra o hub pelo ícone do aparelho.'
              : 'Instalação adiada. Você pode instalar pelo menu do navegador.',
          );
        }
        if (action === 'download' && qrReady) {
          const canvas = document.querySelector<HTMLCanvasElement>('#booking-qr');
          if (canvas) {
            const blob = await new Promise<Blob | null>((resolve) =>
              canvas.toBlob(resolve, 'image/png'),
            );
            if (!blob) throw new Error('Não foi possível baixar o QR Code.');
            const url = URL.createObjectURL(blob),
              a = document.createElement('a');
            a.href = url;
            a.download = `${o.shop()!.slug}-agendamento.png`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
            notice('QR Code preparado para baixar.');
          }
        }
      } catch (error) {
        notice(error instanceof Error ? error.message : 'Tente novamente.');
      }
      return true;
    },
  };
}
