// core/contract.js
// The seam between the reusable core and each single-purpose calculator.
// The core knows ONLY these shapes — never a domain term. Each site provides
// a module matching CalculatorModule, and the core renders it identically.

/**
 * @typedef {Object} InputControl
 * @property {string} id        Key written into the values object.
 * @property {string} label     User-facing. Spell every term out in full.
 * @property {'slider'|'number'|'toggle'} type
 * @property {number} [min]
 * @property {number} [max]
 * @property {number} [step]
 * @property {number|boolean} default
 * @property {string} [unit]    e.g. '$', '%', 'years'
 * @property {string} [help]    One-line plain-English explanation.
 */

/**
 * @typedef {Object} Series
 * @property {string} name              One strategy (e.g. "Claim at 62").
 * @property {string} [color]
 * @property {{x:number,y:number}[]} points   Aligned to the shared x grid.
 */

/**
 * @typedef {Object} SummaryItem
 * @property {string} label
 * @property {string} value             Pre-formatted for display.
 * @property {boolean} [primary]        Highlight as the headline result.
 */

/**
 * @typedef {Object} AxisSpec
 * @property {string} label
 * @property {(n:number)=>string} format
 */

/**
 * @typedef {Object} CrossoverSpec
 * @property {number} from     Index of the series that leads first.
 * @property {number} to       Index of the series that overtakes it.
 * @property {string} [label]  Short note drawn at the crossover (plain language).
 */

/**
 * @typedef {Object} ComputeResult
 * @property {SummaryItem[]} summary
 * @property {Series[]} series
 * @property {AxisSpec} xAxis
 * @property {AxisSpec} [yAxis]
 * @property {CrossoverSpec[]} [crossovers]   Which breakevens to mark. If
 *   omitted, the chart marks the first series against the last.
 * @property {{x:number, label?:string, color?:string}[]} [markers]   Optional
 *   vertical reference lines at given x positions (e.g. a planning age). The
 *   core draws them without knowing what they mean.
 */

/**
 * @typedef {Object} CalculatorModule
 * @property {{name:string, tagline:string}} meta
 * @property {InputControl[]} inputs
 * @property {Object<string, Object>} presets   Name -> partial values.
 * @property {(values:Object)=>ComputeResult} compute   Pure: no side effects.
 */

/** Cheap guardrail so a malformed site fails loudly at load, not mid-render. */
export function validateModule(m) {
  const errors = [];
  if (!m.meta?.name) errors.push('meta.name missing');
  if (!Array.isArray(m.inputs)) errors.push('inputs must be an array');
  if (typeof m.compute !== 'function') errors.push('compute must be a function');
  (m.inputs || []).forEach((c, i) => {
    if (!c.id) errors.push(`inputs[${i}].id missing`);
    if (!('default' in c)) errors.push(`inputs[${i}].default missing`);
  });
  if (errors.length) throw new Error(`Invalid calculator module:\n - ${errors.join('\n - ')}`);
  return true;
}
