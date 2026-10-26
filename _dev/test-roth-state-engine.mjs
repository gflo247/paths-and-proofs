#!/usr/bin/env node
// Wiring test for the Roth tool's state and local tax. Since 2026-10-25 computeConversionCost()
// takes it from the Relocation engine (relocation/relo-engine.mjs computeStateAndLocalTax): the
// state's own brackets, deductions, credits, retirement exclusions, Social Security rules,
// federal-tax subtraction and local tax. The engine's rules are proven against primary sources
// by the test-relo-* suites, and the hand-derived Roth cases live in test-roth-scenarios.mjs,
// test-roth-edge-cases.mjs, test-roth-retded.mjs and the local-tax files. This file checks the
// wiring, for all 51 jurisdictions, every filing status and a spread of ages, incomes,
// conversion sizes, basis fractions and local codes:
//   1. the page's inline STRULES table is each state's states.json taxRules and localTax,
//      unchanged (gen-st-table.mjs output);
//   2. cvtTxSt is the engine's tax with the conversion minus without it, on an income vector
//      rebuilt here, with the conversion classified from states.json itself (roth.ex,
//      roth.exMinAge, roth.retDeduction.conversionAgeGate, roth.conversionAsOtherIncome) rather
//      than from the page's generated EXAGE/RETDED/CVTOTHER tables;
//   3. the retirement-side state rate is the engine's marginal tax on $1,000 more IRA
//      withdrawal at the retirement income given, at the retirement-age ages;
//   4. stateHasIncomeTax() agrees with the brackets.
//
// Harness note: the page bridges the engine in from a <script type="module"> as
// window.computeStateAndLocalTax (and federalTaxableSS as window.calcTaxableSS). In a browser
// `window` is the global object, so the classic script's bare names resolve to it; in this
// jsdom + Function-constructor sandbox Node's globalThis and jsdom's window are separate
// objects, so both are bound.

import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';
import { federalTaxableSS } from '../core/retirement-rules.js';
import { computeStateAndLocalTax } from '../relocation/relo-engine.mjs';

const vc = new VirtualConsole();
const dom = new JSDOM(`<!doctype html><body>
  <input id="retSS"><input id="retPen"><input id="retOther">
  <input id="niiIncome"><input id="ltcgIncome">
</body>`, { virtualConsole: vc });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.matchMedia = () => ({ matches: true });
globalThis.window.computeStateAndLocalTax = computeStateAndLocalTax;
globalThis.window.calcTaxableSS = federalTaxableSS;
globalThis.computeStateAndLocalTax = computeStateAndLocalTax;
globalThis.calcTaxableSS = federalTaxableSS;

const html = readFileSync(new URL('../roth-conversion/index.html', import.meta.url), 'utf8');
const markerIdx = html.indexOf('function computeConversionCost');
if (markerIdx === -1) throw new Error('computeConversionCost not found in index.html');
const scriptSrc = html.slice(html.lastIndexOf('<script>', markerIdx) + '<script>'.length, html.indexOf('</script>', markerIdx));
const { computeConversionCost, retirementStateRate, stateHasIncomeTax, ST, STRULES } = new Function(
  scriptSrc + '\nreturn {computeConversionCost, retirementStateRate, stateHasIncomeTax, ST, STRULES};')();

const states = JSON.parse(readFileSync(new URL('../roth-conversion/states.json', import.meta.url), 'utf8'));
const codes = Object.keys(states).filter((k) => k !== '_schema').sort();

let pass = 0, fail = 0, shown = 0;
function check(label, ok) {
  if (ok) pass++;
  else { fail++; if (shown++ < 25) console.log(`FAIL  ${label}`); }
}
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

// --- 1. STRULES is states.json's taxRules and localTax, unchanged ---
check('STRULES covers exactly the states.json jurisdictions', JSON.stringify(Object.keys(STRULES).sort()) === JSON.stringify(codes));
for (const code of codes) {
  const want = { taxRules: states[code].taxRules, ...(states[code].localTax ? { localTax: states[code].localTax } : {}) };
  check(`${code}: STRULES entry equals states.json taxRules/localTax`, JSON.stringify(STRULES[code]) === JSON.stringify(want));
}

// --- 2. cvtTxSt = engine(with) - engine(without), conversion classified from states.json ---
function expectedKind(code, age, spouseAge, isCouple) {
  const r = states[code].roth;
  if (r.ex) {
    const qualAge = isCouple ? Math.min(age, spouseAge) : age;
    return (r.exMinAge == null || qualAge >= r.exMinAge) ? 'none' : 'wages';
  }
  const gate = r.retDeduction?.conversionAgeGate;
  if (gate != null && age < gate) return 'wages';
  if (r.conversionAsOtherIncome) return 'wages';
  return 'ira';
}
function expectedCvtTax(code, cvt, c) {
  const kind = expectedKind(code, c.curAge, c.spouseAge, c.isCouple);
  const taxable = cvt * c.taxableFrac;
  const inc = (x) => ({
    ss: c.ss, pension: c.pension, capGains: c.ltcg, age: c.curAge, spouseAge: c.spouseAge,
    wages: c.wages + c.nii + (kind === 'wages' ? x : 0), iraWithdrawal: kind === 'ira' ? x : 0,
  });
  const tax = (x) => computeStateAndLocalTax(states[code].taxRules, states[code].localTax, c.status, inc(x), c.localTax).total;
  // Floored at zero, like the retirement-side rate (an excluded conversion can lower Alabama's
  // tax through its federal-tax deduction; the tool counts no state saving).
  return Math.max(0, tax(taxable) - tax(0));
}

const statuses = ['single', 'mfj', 'mfs', 'hoh'];
const ages = [45, 55, 59, 60, 62, 65, 70, 80];
const profiles = [
  { wages: 0, pension: 0, ss: 0, nii: 0, ltcg: 0 },
  { wages: 60000, pension: 0, ss: 0, nii: 0, ltcg: 0 },
  { wages: 0, pension: 40000, ss: 30000, nii: 0, ltcg: 0 },
  { wages: 20000, pension: 25000, ss: 24000, nii: 3000, ltcg: 8000 },
  { wages: 150000, pension: 0, ss: 0, nii: 10000, ltcg: 20000 },
];
const conversions = [5000, 20000, 75000, 250000];
const localCodes = (code) => ['', ...Object.keys(states[code].localTax || {}).filter((k) => states[code].localTax[k].bracketsByStatus)];
const kindsSeen = new Set();

let checked = 0;
for (const code of codes) {
  for (const status of statuses) {
    const isCouple = status === 'mfj' || status === 'mfs';
    for (const age of ages) {
      for (const spouseAge of isCouple ? [age, age - 6] : [null]) {
        for (const p of profiles) {
          for (const cvt of conversions) {
            for (const taxableFrac of [1, 0.6]) {
              for (const localTax of localCodes(code)) {
                checked++;
                const c = { ...p, status, curAge: age, spouseAge, isCouple, taxableFrac, localTax };
                kindsSeen.add(`${code}:${expectedKind(code, age, spouseAge, isCouple)}`);
                const ctx = {
                  income: p.wages, pensionIncome: p.pension, nii: p.nii, ltcg: p.ltcg, ss: p.ss, status,
                  nSr: 0, stD: ST[code], stateCode: code, curAge: age, spouseAge, isCouple, taxableFrac, localTax,
                };
                const got = computeConversionCost(cvt, ctx).cvtTxSt;
                const want = expectedCvtTax(code, cvt, c);
                check(`${code} ${status} age=${age} sp=${spouseAge} ${JSON.stringify(p)} cvt=${cvt} frac=${taxableFrac} local=${localTax}: got ${got}, expected ${want}`, near(got, want));
              }
            }
          }
        }
      }
    }
  }
}

// Every classification the states.json rules can produce actually occurs in the grid.
for (const [code, kind] of [['PA', 'none'], ['IL', 'none'], ['MS', 'none'], ['MS', 'wages'], ['IA', 'none'], ['IA', 'wages'],
  ['MI', 'wages'], ['MI', 'ira'], ['OH', 'wages'], ['CA', 'ira'], ['NY', 'ira']]) {
  check(`grid reaches ${code} as '${kind}'`, kindsSeen.has(`${code}:${kind}`));
}

// --- 3. Retirement-side state rate ---
// retirementStateRate(code, status, localTax, curAge, retAge, spouseAge, ret): the engine's tax
// on $1,000 more IRA withdrawal at the retirement income, at max(retAge, curAge) (the spouse
// aged by the same number of years), as a rate rounded to 4 places and floored at 0. Where
// states.json gives an IRA age gate (Michigan's roth.retDeduction.conversionAgeGate: an IRA
// distribution counts as retirement income only from 59 1/2), withdrawals before it are
// ordinary income.
const retIncomes = [
  { ss: 0, pension: 0, other: 0, withdrawals: 0 },
  { ss: 30000, pension: 20000, other: 0, withdrawals: 25000 },
  { ss: 45000, pension: 60000, other: 10000, withdrawals: 80000 },
];
for (const code of codes) {
  for (const status of statuses) {
    const isCouple = status === 'mfj' || status === 'mfs';
    for (const [curAge, retAge] of [[50, 67], [60, 65], [70, 67], [45, 55], [50, 59]]) {
      const spouseAge = isCouple ? curAge - 3 : null;
      for (const ret of retIncomes) {
        for (const localTax of localCodes(code)) {
          const age = Math.max(retAge, curAge);
          const sp = spouseAge == null ? null : spouseAge + (age - curAge);
          const gate = states[code].roth.retDeduction?.conversionAgeGate;
          const ordinary = gate != null && age < gate;
          const inc = (extra) => ({ ss: ret.ss, pension: ret.pension, capGains: 0, age, spouseAge: sp,
            wages: ret.other + (ordinary ? ret.withdrawals + extra : 0),
            iraWithdrawal: ordinary ? 0 : ret.withdrawals + extra });
          const t = (x) => computeStateAndLocalTax(states[code].taxRules, states[code].localTax, status, inc(x), localTax).total;
          const want = Math.max(0, Math.round((t(1000) - t(0)) / 1000 * 10000) / 10000);
          const got = retirementStateRate(code, status, localTax, curAge, retAge, spouseAge, ret);
          check(`${code} ${status} retirement rate ${curAge}->${retAge} ${JSON.stringify(ret)} local=${localTax}: got ${got}, expected ${want}`, got === want);
        }
      }
    }
  }
}

// --- 4. stateHasIncomeTax ---
for (const code of codes) {
  const want = Object.values(states[code].taxRules.bracketsByStatus).some((rows) => rows.some((b) => b.rate > 0));
  check(`${code}: stateHasIncomeTax is ${want}`, stateHasIncomeTax(code) === want);
}
check('no-income-tax states read false (TX, FL, WA, NV)', ['TX', 'FL', 'WA', 'NV'].every((c) => !stateHasIncomeTax(c)));
check('blank state reads false', stateHasIncomeTax('') === false);

console.log(`Checked ${checked.toLocaleString()} conversion combinations across ${codes.length} jurisdictions.`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
