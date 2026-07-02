// core/app.js
// The whole point: this file references calculator.inputs / calculator.compute
// and NOTHING domain-specific. The same code runs Social Security, rent-vs-buy,
// or anything else that satisfies the contract.

import { validateModule } from './contract.js';
// These three are the shared components from the core (built once, styled by
// the shared design tokens). Their internals are out of scope here.
import { buildControls } from './controls.js';   // renders inputs -> Document Object Model (DOM)
import { drawChart }     from './chart.js';       // the sensitivity chart + crossover annotation
import { drawSummary }   from './summary.js';     // the results card

/**
 * @param {import('./contract.js').CalculatorModule} calculator
 * @param {HTMLElement} root
 */
export function mount(calculator, root, onResult) {
  validateModule(calculator);

  // Seed live state from each control's default.
  const values = {};
  calculator.inputs.forEach((c) => { values[c.id] = c.default; });

  function recompute() {
    const result = calculator.compute(values);   // pure, domain-owned
    drawChart(result, root.querySelector('[data-chart]'));   // core finds crossovers
    drawSummary(result.summary, root.querySelector('[data-summary]'));
    if (typeof onResult === 'function') onResult(result); // optional: page-specific blocks
  }

  // A control change mutates values and re-runs the loop. That's the entire engine.
  buildControls(calculator.inputs, values, recompute, root.querySelector('[data-controls]'));
  recompute();

  return {
    loadPreset(name) {
      Object.assign(values, calculator.presets[name] || {});
      buildControls(calculator.inputs, values, recompute, root.querySelector('[data-controls]'));
      recompute();
    },
  };
}
