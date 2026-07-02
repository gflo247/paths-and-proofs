// core/controls.js
// Renders a calculator's inputs as live controls wired to a recompute callback.
// Domain-free: it knows only the InputControl shape from the contract.

function formatValue(control, v) {
  if (control.type === 'toggle') return v ? 'On' : 'Off';
  if (control.type === 'select') {
    const opt = (control.options || []).find((o) => o.value === v);
    return opt ? opt.label : `${v}`;
  }
  if (control.unit === '$') return `$${Number(v).toLocaleString()}`;
  if (control.unit === '%') return `${v}%`;
  return control.unit ? `${v} ${control.unit}` : `${v}`;
}

/**
 * @param {import('./contract.js').InputControl[]} inputs
 * @param {Object} values     Mutated in place as the user adjusts controls.
 * @param {() => void} onChange  Called after every change.
 * @param {HTMLElement} container
 */
export function buildControls(inputs, values, onChange, container) {
  if (!container) return;
  container.replaceChildren();

  inputs.forEach((c) => {
    const wrap = document.createElement('div');
    wrap.className = 'control';

    const label = document.createElement('label');
    label.className = 'control-label';
    label.setAttribute('for', `ctl-${c.id}`);
    label.textContent = c.label;

    const readout = document.createElement('span');
    readout.className = 'control-value';
    readout.setAttribute('aria-live', 'polite');
    readout.textContent = formatValue(c, values[c.id]);
    // A select shows its own chosen value, so the separate readout would be redundant.
    if (c.type === 'select') readout.style.display = 'none';

    let input;
    if (c.type === 'select') {
      input = document.createElement('select');
      input.id = `ctl-${c.id}`;
      input.className = 'control-input control-select';
      (c.options || []).forEach((o) => {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        if (o.value === values[c.id]) opt.selected = true;
        input.append(opt);
      });
      input.addEventListener('change', () => {
        values[c.id] = input.value;
        readout.textContent = formatValue(c, values[c.id]);
        onChange();
      });
    } else {
      input = document.createElement('input');
      input.id = `ctl-${c.id}`;
      input.className = 'control-input';

      if (c.type === 'toggle') {
        input.type = 'checkbox';
        input.checked = !!values[c.id];
        input.addEventListener('change', () => {
          values[c.id] = input.checked;
          readout.textContent = formatValue(c, values[c.id]);
          onChange();
        });
      } else {
        input.type = c.type === 'slider' ? 'range' : 'number';
        if (c.min != null) input.min = c.min;
        if (c.max != null) input.max = c.max;
        if (c.step != null) input.step = c.step;
        input.value = values[c.id];
        if (input.type === 'number') input.inputMode = 'decimal';
        input.addEventListener('input', () => {
          if (input.value === '') return;          // wait for a real value, don't flash zero
          values[c.id] = Number(input.value);
          readout.textContent = formatValue(c, values[c.id]);
          onChange();
        });
      }
    }

    const head = document.createElement('div');
    head.className = 'control-head';
    head.append(label, readout);
    wrap.append(head, input);

    if (c.help) {
      const help = document.createElement('p');
      help.className = 'control-help';
      help.textContent = c.help;
      wrap.append(help);
    }
    container.append(wrap);
  });
}
