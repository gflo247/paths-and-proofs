// core/bootstrap.js
// One-line page wiring. A calculator page does:
//   import { bootstrap } from '../core/bootstrap.js';
//   import * as mod from './social-security.js';
//   bootstrap(mod);

import { mount } from './app.js';
import { applyOSTheme, installThemeToggle } from './theme.js';

export function bootstrap(module, onResult) {
  applyOSTheme();
  installThemeToggle();

  const api = mount(module, document.getElementById('calc'), onResult);

  const presetsEl = document.getElementById('presets');
  if (presetsEl && module.presets) {
    Object.keys(module.presets).forEach((name) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'preset';
      b.textContent = name;
      b.addEventListener('click', () => api.loadPreset(name));
      presetsEl.append(b);
    });
  }
  return api;
}
