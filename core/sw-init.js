// Service worker registration and update-notification banner.
// Imported by core/bootstrap.js (Social Security, Relocation, Medicare)
// and by roth-conversion/index.html's module bridge.
// Creates the banner programmatically — no HTML changes needed per-page.

if ('serviceWorker' in navigator) {
  // Banner — appended to body, hidden until a new SW is waiting.
  const banner = document.createElement('div');
  banner.id = 'sw-update-banner';
  banner.setAttribute('role', 'status');
  banner.style.cssText = [
    'display:none',
    'position:fixed',
    'bottom:1.25rem',
    'left:50%',
    'transform:translateX(-50%)',
    'background:#1C3A5E',
    'color:#fff',
    'padding:.6rem 1.1rem',
    'border-radius:6px',
    'font-size:.85rem',
    'z-index:9999',
    'box-shadow:0 2px 10px rgba(0,0,0,.35)',
    'white-space:nowrap',
  ].join(';');
  banner.innerHTML = 'A new version is available'
    + '&nbsp;<button id="sw-update-btn" style="'
    + 'background:#fff;color:#1C3A5E;border:none;'
    + 'padding:.2rem .65rem;border-radius:4px;'
    + 'cursor:pointer;font-weight:600;margin-left:.3rem'
    + '">Refresh</button>';
  document.body.appendChild(banner);

  // Capture before registration — used to distinguish an update (prevController
  // non-null) from first install (prevController null, clients.claim() fires
  // controllerchange without any user action).
  const prevController = navigator.serviceWorker.controller;

  navigator.serviceWorker.register('/sw.js').then(reg => {
    // New SW found while page is open — show banner once it's installed.
    reg.addEventListener('updatefound', () => {
      const next = reg.installing;
      next.addEventListener('statechange', () => {
        if (next.state === 'installed' && navigator.serviceWorker.controller) {
          banner.style.display = 'block';
        }
      });
    });
  }).catch(err => console.warn('SW registration failed:', err));

  // Refresh button: tell the waiting SW to activate immediately.
  document.addEventListener('click', e => {
    if (e.target.id !== 'sw-update-btn') return;
    navigator.serviceWorker.ready.then(reg => {
      if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    });
  });

  // SW activated (after skipWaiting) — reload to pick up new version.
  // Guard: only reload when updating an existing SW, not on first install
  // (clients.claim() during first activate also fires controllerchange).
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (prevController) window.location.reload();
  });
}
