// core/bootstrap.js
// One-line page wiring. A calculator page does:
//   import { bootstrap } from '../core/bootstrap.js';
//   import * as mod from './social-security.js';
//   bootstrap(mod);

import { mount } from './app.js';
import { applyOSTheme, installThemeToggle } from './theme.js';
import './sw-init.js';

export function bootstrap(module, onResult) {
  applyOSTheme();
  installThemeToggle();
  // Move the toggle into the sticky page header (non-Roth tools only).
  const btn = document.getElementById('themeToggle');
  const headerRow = document.querySelector('.page-header-row');
  if (headerRow && btn) headerRow.appendChild(btn);

  // Lock icon: tap to reveal/hide privacy note on mobile.
  const privacyBtn = document.querySelector('.page-privacy-note');
  if (privacyBtn) {
    privacyBtn.addEventListener('click', (e) => {
      const open = privacyBtn.getAttribute('aria-expanded') === 'true';
      privacyBtn.setAttribute('aria-expanded', open ? 'false' : 'true');
      e.stopPropagation();
    });
    document.addEventListener('click', () => privacyBtn.setAttribute('aria-expanded', 'false'));
  }

  const api = mount(module, document.getElementById('calc'), onResult);

  const presetsEl = document.getElementById('presets');
  if (presetsEl && module.presets) {
    const presetNames = Object.keys(module.presets);
    const buttons = [];
    const setActive = (btn) => buttons.forEach(b => b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'));
    presetNames.forEach((name) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'preset';
      b.setAttribute('aria-pressed', 'false');
      b.textContent = name;
      b.addEventListener('click', () => { setActive(b); api.loadPreset(name); });
      presetsEl.append(b);
      buttons.push(b);
    });
    // Auto-load the first preset on a fresh page load. Skip if a share link is
    // present — the share link decoder runs after bootstrap and wins over any preset.
    if (!location.hash && buttons.length) {
      setActive(buttons[0]);
      api.loadPreset(presetNames[0]);
    }
  }
  return api;
}
