#!/usr/bin/env node
// Michigan grid for computeConversionCost(): the Roth tool's Michigan tax on a conversion
// (from the Relocation engine since 2026-10-25) against a closed form of Michigan's 2026
// rules, written out here independently of both the page and the engine:
//
//   Michigan taxable income = max(0, wages + interest + gains + C_ord
//                                    + max(0, pension + C_ret - cap) - exemption)
//   tax = 4.25% x taxable income; cvtTxSt = tax(with conversion) - tax(without)
//
//   cap        $67,610 single, separate and head of household; $135,220 joint
//              (states.json MI.roth.retDeduction; 2026 Form 446 lists the same limits)
//   exemption  $5,900 per person (Treasury Form 446, 2026): one, or two on a joint return
//   C_ret      the conversion, from age 59 1/2 (roth.retDeduction.conversionAgeGate; MI
//              Treasury: the rollover qualifies for the subtraction only at that age)
//   C_ord      the conversion below that age: ordinary income, while pension income still
//              uses the cap
//   Social Security is exempt and wages never use the cap.
//
// Replaces the 2026-08-24 version, which extracted the page's own RETDED branch (since
// removed) and checked it against 4.25% of the change in income above the cap. That left
// out the personal exemption, so a conversion the exemption still covered read as taxed.

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
// Same harness-only binding as test-roth-state-engine.mjs (window and globalThis differ here).
globalThis.window.computeStateAndLocalTax = computeStateAndLocalTax;
globalThis.window.calcTaxableSS = federalTaxableSS;
globalThis.computeStateAndLocalTax = computeStateAndLocalTax;
globalThis.calcTaxableSS = federalTaxableSS;

const html = readFileSync(new URL('../roth-conversion/index.html', import.meta.url), 'utf8');
const markerIdx = html.indexOf('function computeConversionCost');
if (markerIdx === -1) throw new Error('computeConversionCost not found in index.html');
const scriptSrc = html.slice(html.lastIndexOf('<script>', markerIdx) + '<script>'.length, html.indexOf('</script>', markerIdx));
const { computeConversionCost, ST } = new Function(scriptSrc + '\nreturn {computeConversionCost, ST};')();

const RATE = 0.0425;
const CAP = { single: 67610, mfj: 135220, mfs: 67610, hoh: 67610 };
const EXEMPTION = 5900;
const GATE = 59.5;

// The constants above are Michigan's; if states.json moves, this file must be re-derived.
const states = JSON.parse(readFileSync(new URL('../roth-conversion/states.json', import.meta.url), 'utf8'));
const mi = states.MI;
const drift = [];
if (mi.roth.retDeduction.conversionAgeGate !== GATE) drift.push('conversionAgeGate');
for (const s of Object.keys(CAP)) if (mi.roth.retDeduction[s] !== CAP[s]) drift.push(`cap ${s}`);
if (mi.taxRules.standardDeduction.deduction.single !== EXEMPTION || mi.taxRules.standardDeduction.deduction.mfj !== 2 * EXEMPTION) drift.push('exemption');
if (mi.taxRules.bracketsByStatus.single.length !== 1 || mi.taxRules.bracketsByStatus.single[0].rate !== RATE) drift.push('rate');
if (drift.length) throw new Error(`states.json Michigan figures changed (${drift.join(', ')}): re-derive this test`);

function miTax(status, { wages, nii, ltcg, pension, cvtOrd, cvtRet }) {
  const exemption = EXEMPTION * (status === 'mfj' ? 2 : 1);
  const taxable = Math.max(0, wages + nii + ltcg + cvtOrd + Math.max(0, pension + cvtRet - CAP[status]) - exemption);
  return RATE * taxable;
}

let pass = 0, fail = 0;
function check(label, actual, expected, tolerance = 1e-6) {
  if (Math.abs(actual - expected) <= tolerance) pass++;
  else { fail++; console.log(`FAIL  ${label}  (got=${actual}, expected=${expected})`); }
}

const statuses = ['single', 'mfj', 'mfs', 'hoh'];
const pensionAmts = [0, 30000, 67610, 67611, 100000, 135220, 135221, 200000];
const wageAmts = [0, 4000, 30000];
const cvtAmts = [0, 5000, 20000, 50000, 100000];
const ages = [30, 45, 59, 59.5, 60, 70];

let checked = 0;
for (const status of statuses) {
  const isCouple = status === 'mfj' || status === 'mfs';
  for (const pension of pensionAmts) {
    for (const wages of wageAmts) {
      for (const cvt of cvtAmts) {
        for (const curAge of ages) {
          for (const [ss, nii, ltcg] of [[0, 0, 0], [25000, 2000, 5000]]) {
            checked++;
            const ctx = {
              income: wages, pensionIncome: pension, nii, ltcg, ss, status, nSr: 0,
              stD: ST.MI, stateCode: 'MI', curAge, spouseAge: isCouple ? curAge : null, isCouple,
              taxableFrac: 1, localTax: '',
            };
            const got = computeConversionCost(cvt, ctx).cvtTxSt;
            const qualifies = curAge >= GATE;
            const base = { wages, nii, ltcg, pension, cvtOrd: 0, cvtRet: 0 };
            const withCvt = { ...base, cvtOrd: qualifies ? 0 : cvt, cvtRet: qualifies ? cvt : 0 };
            const expected = miTax(status, withCvt) - miTax(status, base);
            check(`MI ${status} age=${curAge} pension=${pension} wages=${wages} cvt=${cvt} ss=${ss} nii=${nii} ltcg=${ltcg}`, got, expected);
          }
        }
      }
    }
  }
}

// Worked cases (hand arithmetic, one per mechanism):
const one = (cvt, o) => computeConversionCost(cvt, { income: 0, pensionIncome: 0, nii: 0, ltcg: 0, ss: 0, status: 'single', nSr: 0,
  stD: ST.MI, stateCode: 'MI', curAge: 65, spouseAge: null, isCouple: false, taxableFrac: 1, localTax: '', ...o }).cvtTxSt;
// 70, $30k pension, $20k conversion: 50,000 is under the cap → $0.
check('worked: 70, pension 30k, cvt 20k → $0 (under the cap)', one(20000, { curAge: 70, pensionIncome: 30000 }), 0);
// 70, $60k pension, $20k conversion: 80,000 - 67,610 = 12,390 - 5,900 = 6,490 x 4.25% = 275.825.
check('worked: 70, pension 60k, cvt 20k → $275.83 (12,390 over the cap, less the exemption)', one(20000, { curAge: 70, pensionIncome: 60000 }), 275.825);
// 55, $30k pension, $20k conversion: the pension is under the cap; the conversion is taxed after
// the exemption: (20,000 - 5,900) x 4.25% = 599.25.
check('worked: 55, pension 30k, cvt 20k → $599.25 (under 59 1/2: no cap shelter)', one(20000, { curAge: 55, pensionIncome: 30000 }), 599.25);
// 55, $10k wages, $20k conversion: the wages already use the whole $5,900 exemption, so the
// conversion is taxed in full: 20,000 x 4.25% = 850.
check('worked: 55, wages 10k, cvt 20k → $850 (exemption already used by wages)', one(20000, { curAge: 55, income: 10000 }), 850);

console.log(`Checked ${checked.toLocaleString()} Michigan combinations across ${statuses.length} filing statuses and ${ages.length} ages (incl. the 59 1/2 conversion gate).`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
