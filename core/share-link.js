// Shared share-link utilities for the core-engine tools
// (Social Security, Relocation, Medicare).
// Roth Conversion has its own self-contained implementation — it has
// additional concerns (autosave suppression, wizard skip-flag persistence)
// that don't apply here since none of these three tools use localStorage.

// UTF-8-safe Base64, URL-safe variant — matches Roth's encoding so the
// hash format is consistent across all tools.
function b64encode(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64decode(str) {
  // Restore standard Base64 (undo URL-safe substitutions, re-add padding).
  const padded = str.replace(/-/g, '+').replace(/_/g, '/')
    + '==='.slice((str.length + 3) % 4 === 0 ? 3 : (str.length + 3) % 4);
  return decodeURIComponent(escape(atob(padded)));
}

export function encodeShareState(fields) {
  const obj = {};
  for (const id of fields) {
    const el = document.getElementById(id);
    if (el) obj[id] = el.value;
  }
  return 'v1.' + b64encode(JSON.stringify(obj));
}

export function decodeShareState(str) {
  if (!str || !str.startsWith('v1.')) return null;
  try {
    return JSON.parse(b64decode(str.slice(3)));
  } catch {
    return null;
  }
}

// Applies decoded share state to the DOM.
// Clamps numeric fields to their HTML min/max — the hash payload is
// untrusted (anyone can hand-edit it), so we enforce bounds on write.
// Dispatches the native event that each element's existing listener
// expects, so the engine recomputes after every field is set.
export function applyShareInputs(obj, fields) {
  for (const id of fields) {
    if (!(id in obj)) continue;
    const el = document.getElementById(id);
    if (!el) continue;
    const raw = obj[id];
    const type = el.type; // 'number', 'range', 'select-one', etc.
    if (type === 'number' || type === 'range') {
      const lo = el.min !== '' ? parseFloat(el.min) : -Infinity;
      const hi = el.max !== '' ? parseFloat(el.max) : Infinity;
      el.value = Math.min(hi, Math.max(lo, parseFloat(raw) || 0));
    } else {
      el.value = raw; // select: unrecognized values are a no-op in browsers
    }
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  }
}

// Sets up the share-link panel for a tool.
//
// fields — ordered array of DOM element IDs to serialize. For core-generated
//   controls the IDs are 'ctl-{id}' (core/controls.js's naming convention).
//   Custom controls (e.g. Relocation's local-tax selects) use their own IDs.
//   For Relocation: put state selects first so visibility is set before
//   local-tax selects are applied.
//
// Returns the created <details> element (useful for tests).
export function initShareLink(fields) {
  // 1. Decode and apply if the URL has a share hash.
  const rawHash = location.hash;
  if (rawHash.startsWith('#s=')) {
    const decoded = decodeShareState(rawHash.slice(3));
    if (decoded) {
      applyShareInputs(decoded, fields);
      history.replaceState(null, '', location.pathname + location.search);
    }
  }

  // 2. Build the share panel.
  const details = document.createElement('details');
  details.className = 'share-panel';

  const summary = document.createElement('summary');
  const hint = document.createElement('span');
  hint.className = 'share-panel-hint';
  hint.textContent = 'Send to a spouse or advisor, or bookmark for later';
  summary.append('🔗 Share this scenario', hint);
  details.appendChild(summary);

  const inner = document.createElement('div');
  inner.className = 'share-panel-body';

  const row = document.createElement('div');
  row.className = 'share-link-row';

  const box = document.createElement('input');
  box.type = 'text';
  box.id = 'shareLinkBox';
  box.className = 'share-link-box';
  box.readOnly = true;
  box.addEventListener('click', () => box.select());

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'shareCopyBtn';
  btn.className = 'share-copy-btn';
  btn.textContent = 'Copy link';

  row.appendChild(box);
  row.appendChild(btn);

  const shareNote = document.createElement('div');
  shareNote.className = 'share-note';
  shareNote.textContent = 'This link contains your numbers — only share it somewhere you\'re comfortable with that (e.g. your spouse or advisor). It never touches this site\'s servers, but becomes plain text the moment you paste it into a text, email, or chat.';

  inner.appendChild(row);
  inner.appendChild(shareNote);
  details.appendChild(inner);

  function refreshLink(selectAfter) {
    box.value = location.origin + location.pathname + '#s=' + encodeShareState(fields);
    if (selectAfter) box.select();
  }

  // Refresh when the panel opens (auto-selects link text for easy copy).
  details.addEventListener('toggle', () => {
    if (details.open) refreshLink(true);
  });

  // Keep link in sync with live edits while the panel is open.
  const calc = document.getElementById('calc');
  if (calc) {
    calc.addEventListener('input',  () => { if (details.open) refreshLink(false); });
    calc.addEventListener('change', () => { if (details.open) refreshLink(false); });
  }

  // Copy button: 800ms timeout + execCommand fallback.
  // navigator.clipboard.writeText can hang indefinitely without resolving or
  // rejecting in some environments (observed live in Chrome automation).
  btn.addEventListener('click', () => {
    const url = box.value;
    const orig = btn.textContent;
    let done = false;
    function finish(ok) {
      if (done) return;
      done = true;
      btn.textContent = ok ? 'Copied!' : 'Copy the link above';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      const t = setTimeout(() => {
        box.select();
        try { document.execCommand('copy'); finish(true); } catch { finish(false); }
      }, 800);
      navigator.clipboard.writeText(url)
        .then(() => { clearTimeout(t); finish(true); })
        .catch(() => {
          clearTimeout(t);
          box.select();
          try { document.execCommand('copy'); finish(true); } catch { finish(false); }
        });
    } else {
      box.select();
      try { document.execCommand('copy'); finish(true); } catch { finish(false); }
    }
  });

  // 3. Insert the panel after [data-local-tax] if present (Relocation's
  // custom local-tax wrapper), otherwise after [data-controls].
  const anchor = document.querySelector('[data-local-tax]') || document.querySelector('[data-controls]');
  if (anchor) anchor.after(details);

  return details; // exposed for tests
}
