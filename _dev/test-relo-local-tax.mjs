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
//
// Every one of these local taxes is levied on the state's taxable income, after its
// deductions and exemptions (NYC: NY taxable income; Metro and Multnomah: Oregon
// taxable income; MD: Maryland taxable net income; IN: Indiana AGI less exemptions).
// Updated 2026-10-22: the expectations used ordinary income before the deductions.

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
  // MD taxable net income: 100,000 - 3,350 standard - 3,200 exemption (federal AGI
  // <= $100,000) - 1,000 age 65 = 92,450; 3.2% = 2,958.40.
  check('MD: flat 3.2% county tax on Maryland taxable net income ($92,450)', local, 2958);
  const localWithCode = computeLocalTax(states.MD.localTax, 'single', r.breakdown, r.tax, 'nyc');
  check('MD: unaffected by an (irrelevant) localCode', localWithCode, local);
}

// --- IN flat county tax -------------------------------------------------------
{
  const income = { wages: 100000, age: 67 };
  const r = computeStateIncomeTax(states.IN.taxRules, 'single', income);
  const local = computeLocalTax(states.IN.localTax, 'single', r.breakdown, r.tax, '');
  // Indiana AGI less exemptions: 100,000 - 1,000 - 1,000 (age 65) = 98,000; 1.97% = 1,930.60.
  check('IN: flat 1.97% county tax on Indiana AGI less exemptions ($98,000)', local, 1931);
}

// --- NYC graduated bracket ladder --------------------------------------------
{
  const income = { wages: 60000, age: 67 }; // straddles the $50,000 tier boundary
  const r = computeStateIncomeTax(states.NY.taxRules, 'single', income);
  const local = computeLocalTax(states.NY.localTax, 'single', r.breakdown, r.tax, 'nyc');
  // NY taxable income 60,000 - 8,000 = 52,000. Hand-traced against
  // NY.localTax.nyc.bracketsByStatus.single:
  // 12000*0.03078 + 13000*0.03762 + 25000*0.03819 + 2000*0.03876 = 1,890.69
  check('NYC: graduated 4-tier ladder on NY taxable income ($52,000)', local, 1891);
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
  // Oregon taxable income 150,000 - 2,900 - 1,200 (65+) = 145,900; 1% x 20,900.
  check('Metro: 1% of Oregon taxable income above $125,000 single', local, 209);
}

// --- Multnomah stacking on top of Metro ---------------------------------------
{
  const income = { wages: 300000, age: 67 };
  const r = computeStateIncomeTax(states.OR.taxRules, 'single', income);
  const local = computeLocalTax(states.OR.localTax, 'single', r.breakdown, r.tax, 'multnomah');
  // Oregon taxable income 300,000 - 4,100 = 295,900.
  // Metro: (295900-125000)*0.01 = 1709
  // Multnomah: (250000-125000)*0.015 + (295900-250000)*0.03 = 1875 + 1377 = 3252
  // Multnomah owes BOTH, stacked -- 1709 + 3252 = 4961.
  check('Multnomah: stacks on top of Metro, not mutually exclusive', local, 4961);
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
