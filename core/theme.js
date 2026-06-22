// core/theme.js
// Stateless theme handling, shared by the calculator pages.
//
// Default: follow the operating system's light/dark preference.
// Override: a sun/moon button flips the theme for THIS visit only — nothing is
// stored, so a reload returns to following the OS. This keeps the whole family
// stateless (no localStorage), which matches the privacy-first character of the
// other tools (the vault stores nothing by design).
//
// The icons are the shared currentColor SVGs from /shared/icons.

const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

/** Set the theme to OS preference. Called on load. */
export function applyOSTheme() {
  const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
}

/** Build the toggle button and wire it up. Returns the button element. */
export function installThemeToggle() {
  // Avoid duplicates if called twice.
  if (document.getElementById('themeToggle')) return document.getElementById('themeToggle');

  const btn = document.createElement('button');
  btn.id = 'themeToggle';
  btn.type = 'button';
  btn.className = 'theme-toggle';
  btn.innerHTML = `<span class="ic-sun" aria-hidden="true">${SUN}</span><span class="ic-moon" aria-hidden="true">${MOON}</span>`;

  function sync() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
    btn.title = label;
    btn.setAttribute('aria-label', label);
  }

  btn.addEventListener('click', () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
    sync();
    // Some charts read the theme at draw time; nudge a redraw if the page exposes one.
    if (typeof window.__redrawOnThemeChange === 'function') {
      try { window.__redrawOnThemeChange(); } catch (e) { /* no-op */ }
    }
  });

  sync();
  document.body.appendChild(btn);
  return btn;
}
