// Service worker registration and silent auto-reload.
// Imported by core/bootstrap.js (Social Security, Relocation, Medicare, Life
// Insurance), roth-conversion/index.html's module bridge and espp/index.html.
// When a new SW installs, activates it immediately. Reloads only a page the
// person hasn't touched, as soon as it's hidden or no input has focus: once they
// type, click or open a share link, their numbers exist only in the page.

if ('serviceWorker' in navigator) {
  // Capture before registration — distinguishes an update (prevController
  // non-null) from first install (clients.claim() also fires controllerchange).
  const prevController = navigator.serviceWorker.controller;

  const safe = () =>
    !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) &&
    !document.activeElement?.isContentEditable;

  // Any interaction, or a share link filling in values, marks the page as
  // holding work a reload would wipe. Capture phase, so keystrokes a strict
  // control stops from bubbling still count.
  let touched = false;
  for (const type of ['pointerdown', 'keydown', 'input', 'change']) {
    document.addEventListener(type, () => { touched = true; }, { capture: true, passive: true });
  }

  let _swRefreshing = false;

  const reloadWhenSafe = () => {
    if (touched) { _swRefreshing = false; return; }   // keep their work; the update applies on the next page load
    if (document.hidden || safe()) { location.reload(); return; }
    setTimeout(reloadWhenSafe, 1000);
  };

  // If the user switches tabs while we're polling, reload immediately.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && _swRefreshing && !touched) location.reload();
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
