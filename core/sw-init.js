// Service worker registration and silent auto-reload.
// Imported by core/bootstrap.js (Social Security, Relocation, Medicare)
// and by roth-conversion/index.html's module bridge.
// When a new SW installs, activates it immediately and reloads as soon as
// the tab is safe: hidden, or no focused input / contentEditable element.

if ('serviceWorker' in navigator) {
  // Capture before registration — distinguishes an update (prevController
  // non-null) from first install (clients.claim() also fires controllerchange).
  const prevController = navigator.serviceWorker.controller;

  const safe = () =>
    !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) &&
    !document.activeElement?.isContentEditable;

  let _swRefreshing = false;

  const reloadWhenSafe = () => {
    if (document.hidden || safe()) { location.reload(); return; }
    setTimeout(reloadWhenSafe, 1000);
  };

  // If the user switches tabs while we're polling, reload immediately.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && _swRefreshing) location.reload();
  });

  navigator.serviceWorker.register('/sw.js').then(reg => {
    // New SW found while page is open — activate it as soon as it's installed.
    reg.addEventListener('updatefound', () => {
      const next = reg.installing;
      next.addEventListener('statechange', () => {
        if (next.state === 'installed' && navigator.serviceWorker.controller) {
          if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      });
    });
  }).catch(err => console.warn('SW registration failed:', err));

  // SW activated after skipWaiting — reload when the tab is safe.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!prevController) return; // first install, not an update
    _swRefreshing = true;
    reloadWhenSafe();
  });
}
