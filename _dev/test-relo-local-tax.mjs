#!/usr/bin/env node
// Regression test for relo-engine.mjs's computeLocalTax() (2026-08-27) — the
// Relocation tool's port of Roth's four local (county/city) income tax rules,
// previously modeled only in roth-conversion/index.html and entirely absent
// from Relocation. See memory: roth-relo-local-tax-port.
//
// Six mechanisms, hand-traced against the actual NY/OR/MD/IN localTax JSON
// (states.json), not against computeLocalTax's own internals:
//   1. MD flat county tax (mandatory, unconditional)
//   2. IN flat county tax (mandatory, unconditional)
//   3. NYC's graduated 4-tier bracket ladder (opt-in)
//   4. Yonkers' flat surcharge on NY state tax itself (opt-in)
//   5. Metro's threshold-gated bracket ladder (opt-in)
//   6. Multnomah stacking ON TOP of Metro (opt-in, not mutually exclusive)
// Plus two safety-net cases: a state with no localTax at all, and NY selected
// with no locality chosen (most NY residents pay $0 local tax).

import { computeStateIncomeTax, computeLocalTax } from '../relocation/relo-engine.mjs';
import { readFileSync } from 'node:fs';

const states = JSON.parse(readFileSync(new URL('../roth-conversion/states.json', import.meta.url), 'utf8'));

let pass = 0, fail = 0;
function check(label, actual, expected, tolerance = 1) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) { pass++; console.log(`ok    ${label}`); }
  else { fail++; console.log(`FAIL  ${label}  (got ${actual}, expected ${expected} ±${tolerance})`); }
}

// --- MD flat county tax ------------------------------------------------------
{
  const income = { wages: 100000, age: 67 };
  const r = computeStateIncomeTax(states.MD.taxRules, 'single', income);
  const local = computeLocalTax(states.MD.localTax, 'single', r.breakdown, r.tax, '');
  // Unconditional -- no selector needed, applies regardless of localCode.
  check('MD: flat 3.2% county tax on ordinary income', local, Math.round(r.breakdown.ordinaryIncome * 0.032));
  const localWithCode = computeLocalTax(states.MD.localTax, 'single', r.breakdown, r.tax, 'nyc');
  check('MD: unaffected by an (irrelevant) localCode', localWithCode, local);
}

// --- IN flat county tax -------------------------------------------------------
{
  const income = { wages: 100000, age: 67 };
  const r = computeStateIncomeTax(states.IN.taxRules, 'single', income);
  const local = computeLocalTax(states.IN.localTax, 'single', r.breakdown, r.tax, '');
  check('IN: flat 1.97% county tax on ordinary income', local, Math.round(r.breakdown.ordinaryIncome * 0.0197));
}

// --- NYC graduated bracket ladder --------------------------------------------
{
  const income = { wages: 60000, age: 67 }; // straddles the $50,000 tier boundary
  const r = computeStateIncomeTax(states.NY.taxRules, 'single', income);
  const local = computeLocalTax(states.NY.localTax, 'single', r.breakdown, r.tax, 'nyc');
  // Hand-traced against NY.localTax.nyc.bracketsByStatus.single:
  // 12000*0.03078 + 13000*0.03762 + 25000*0.03819 + 10000*0.03876
  const expected = 12000 * 0.03078 + 13000 * 0.03762 + 25000 * 0.03819 + 10000 * 0.03876;
  check('NYC: graduated 4-tier ladder on ordinary income', local, Math.round(expected));
}

// --- Yonkers flat surcharge on state tax -------------------------------------
{
  const income = { wages: 60000, age: 67 };
  const r = computeStateIncomeTax(states.NY.taxRules, 'single', income);
  const local = computeLocalTax(states.NY.localTax, 'single', r.breakdown, r.tax, 'yonkers');
  // A surcharge on the STATE tax liability itself, not a separate income-based
  // calculation -- mathematically exact (linear), tight tolerance.
  check('Yonkers: 16.75% surcharge on NY state tax liability', local, Math.round(r.tax * 0.1675), 0.6);
}

// --- Metro bracket, above the $125,000 single threshold -----------------------
{
  const income = { wages: 150000, age: 67 };
  const r = computeStateIncomeTax(states.OR.taxRules, 'single', income);
  const local = computeLocalTax(states.OR.localTax, 'single', r.breakdown, r.tax, 'metro');
  check('Metro: 1% above $125,000 single threshold', local, Math.round((150000 - 125000) * 0.01));
}

// --- Multnomah stacking on top of Metro ---------------------------------------
{
  const income = { wages: 300000, age: 67 };
  const r = computeStateIncomeTax(states.OR.taxRules, 'single', income);
  const local = computeLocalTax(states.OR.localTax, 'single', r.breakdown, r.tax, 'multnomah');
  // Metro: (300000-125000)*0.01 = 1750
  // Multnomah: (250000-125000)*0.015 + (300000-250000)*0.03 = 1875 + 1500 = 3375
  // Multnomah owes BOTH, stacked -- 1750 + 3375 = 5125.
  const metroPortion = (300000 - 125000) * 0.01;
  const multnomahPortion = (250000 - 125000) * 0.015 + (300000 - 250000) * 0.03;
  check('Multnomah: stacks on top of Metro, not mutually exclusive', local, Math.round(metroPortion + multnomahPortion));
}

// --- Safety nets --------------------------------------------------------------
{
  const income = { wages: 100000, age: 67 };
  const r = computeStateIncomeTax(states.CA.taxRules, 'single', income);
  check('No-op: a state with no localTax at all returns $0 regardless of localCode', computeLocalTax(states.CA.localTax, 'single', r.breakdown, r.tax, 'nyc'), 0);
}
{
  const income = { wages: 60000, age: 67 };
  const r = computeStateIncomeTax(states.NY.taxRules, 'single', income);
  check('Opt-out: NY selected but no locality chosen returns $0 (most NY residents)', computeLocalTax(states.NY.localTax, 'single', r.breakdown, r.tax, ''), 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
