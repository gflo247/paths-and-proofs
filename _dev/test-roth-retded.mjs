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
const { computeConversionCost, moveConversionCost, ST } = new Function(scriptSrc + '\nreturn {computeConversionCost, moveConversionCost, ST};')();

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

// --- isGovernmentPension wiring: private pension raises conversion tax for govOnly states ---
// Confirms isGovernmentPension flows from calc()'s ctx through computeConversionCost to
// resolveRetirementIncome. KS and MA are the clearest hand-derivable cases.
//
// KS single 67, pension=$40k, $10k conversion:
//   Standard deduction: $12,765 + $850 (65+) = $13,615.
//   Government: pension exempt → taxable(with cvt) = max(0, 10000 − 13615) = 0 → cvtTxSt = $0.
//   Private: pension taxable → taxable(without cvt) = 40000 − 13615 = 26385 (past the $23k
//     bracket); taxable(with cvt) = 36385; delta = 10000 × 5.58% = $558.
//
// MA single 67, pension=$40k, $10k conversion:
//   Standard deduction: $4,400 + $700 (65+) = $5,100.
//   Government: pension exempt → taxable(with cvt) = max(0, 10000 − 5100) = 4900 × 5% = $245.
//   Private: pension already taxed → taxable(without cvt) = 34900; delta = 10000 × 5% = $500.
{
  const ctx = (stateCode, pension, isGovernmentPension) => ({
    income: 0, pensionIncome: pension, nii: 0, ltcg: 0, ss: 0,
    status: 'single', nSr: 0, stD: ST[stateCode], stateCode,
    curAge: 67, spouseAge: null, isCouple: false, taxableFrac: 1, localTax: '',
    isGovernmentPension,
  });

  check('KS government pension: $0 state tax on $10k conversion (under standard deduction)',
    computeConversionCost(10000, ctx('KS', 40000, true)).cvtTxSt, 0);
  check('KS private pension $40k: 5.58% on $10k conversion = $558',
    computeConversionCost(10000, ctx('KS', 40000, false)).cvtTxSt, 558);

  check('MA government pension: $245 state tax on $10k conversion (4900 × 5%)',
    computeConversionCost(10000, ctx('MA', 40000, true)).cvtTxSt, 245);
  check('MA private pension $40k: 5% on full $10k conversion = $500',
    computeConversionCost(10000, ctx('MA', 40000, false)).cvtTxSt, 500);
}

// --- The "If You Move to ... First" comparison applies the pension-type answer in the new state ---
// calc() builds the ctx for the state you live in, where a state that ignores the answer gets
// isGovernmentPension = true; moveConversionCost takes the answer itself for the destination.
// Single, 66, a $40,000 pension and nothing else, converting $30,000; the state tax on the
// conversion, by hand from states.json:
//   New York, government pension: exempt, so the conversion takes the $20,000 exclusion:
//     30,000 - 20,000 - 8,000 standard deduction = 2,000 x 3.9% = $78.
//   New York, private pension: pension and conversion share the $20,000. Without the conversion
//     40,000 - 20,000 - 8,000 = 12,000 taxable: 3.9% x 8,500 = 331.50, 4.4% x 3,200 = 140.80,
//     5.15% x 300 = 15.45 = 487.75. With it 42,000: 331.50 + 140.80 + 5.15% x 2,200 = 113.30
//     + 5.4% x 28,100 = 1,517.40 = 2,103.00. The conversion: $1,615.25.
//   Kansas, government pension: 30,000 - 12,765 standard deduction and exemption - 850 at 65
//     = 16,385 x 5.2% = $852.02.
//   Kansas, private pension: the pension alone reaches the 5.58% bracket: 30,000 x 5.58% = $1,674.
{
  const ctx = (stateCode, isGovernmentPension) => ({
    income: 0, pensionIncome: 40000, nii: 0, ltcg: 0, ss: 0,
    status: 'single', nSr: 1, stD: ST[stateCode], stateCode,
    curAge: 66, spouseAge: null, isCouple: false, taxableFrac: 1, localTax: '',
    isGovernmentPension,
  });
  const near = 0.01;
  // Florida ignores the answer, so calc() passes isGovernmentPension = true in its ctx.
  check('move Florida to New York, private pension: New York taxes it, $1,615.25',
    moveConversionCost(30000, ctx('FL', true), 'NY', false).cvtTxSt, 1615.25, near);
  check('move Florida to New York, government pension: $78',
    moveConversionCost(30000, ctx('FL', true), 'NY', true).cvtTxSt, 78, near);
  check('move New York to Kansas, government pension: $852.02',
    moveConversionCost(30000, ctx('NY', true), 'KS', true).cvtTxSt, 852.02, near);
  check('move New York to Kansas, private pension: $1,674',
    moveConversionCost(30000, ctx('NY', false), 'KS', false).cvtTxSt, 1674, near);

  // calc() uses it, with the answer rather than the ctx's flag.
  const calcSrc = html.slice(html.indexOf('function calc()'), html.indexOf('\nfunction ', html.indexOf('function calc()') + 1));
  check('calc(): the move comparison applies the answer in the new state',
    /moveConversionCost\(cvtAmt, ccCtx, reloStateCode, pensionIsGovernment\)/.test(calcSrc) && !/computeConversionCost\(cvtAmt, \{\.\.\.ccCtx/.test(calcSrc) ? 1 : 0, 1, 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
