#!/usr/bin/env node
// Hand-derived state cases for the Roth tool's state tax, which comes from the Relocation engine
// since 2026-10-25 (computeStateAndLocalTax): one case per mechanism the old flat per-state rate
// (ST[code].cr) missed, plus the retirement-side state rate. Every expected value is worked out
// below from the state's 2026 figures in states.json (sources in SOURCES.md) and, where a state
// taxes Social Security or subtracts federal tax, IRS Pub 915 and the engine's 2026 federal
// estimate (FEDERAL_2026, IRS Rev. Proc. 2025-32). Michigan, Mississippi, Iowa, Ohio,
// Massachusetts and Connecticut are in test-roth-edge-cases.mjs and test-roth-retded.mjs;
// New York, Oregon, Maryland and Indiana in the local-tax files.

import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';
import { federalTaxableSS } from '../core/retirement-rules.js';
import { computeStateAndLocalTax } from '../relocation/relo-engine.mjs';

const vc = new VirtualConsole();
const dom = new JSDOM('<!doctype html><body></body>', { virtualConsole: vc });
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
if (markerIdx === -1) throw new Error('computeConversionCost not found');
const scriptSrc = html.slice(html.lastIndexOf('<script>', markerIdx) + '<script>'.length, html.indexOf('</script>', markerIdx));
const { computeConversionCost, retirementStateRate, ST } = new Function(scriptSrc + '\nreturn {computeConversionCost, retirementStateRate, ST};')();

let pass = 0, fail = 0;
function check(label, actual, expected, tolerance = 0.005) {
  if (Math.abs(actual - expected) <= tolerance) pass++;
  else { fail++; console.log(`FAIL  ${label}  (got=${actual}, expected=${expected})`); }
}
const cc = (stateCode, cvt, o) => computeConversionCost(cvt, { income: 0, pensionIncome: 0, nii: 0, ltcg: 0, ss: 0, nSr: 0,
  status: 'single', curAge: 65, spouseAge: null, isCouple: false, taxableFrac: 1, localTax: '', stD: ST[stateCode], stateCode, ...o }).cvtTxSt;
const couple = (age) => ({ status: 'mfj', isCouple: true, curAge: age, spouseAge: age });

// --- California: graduated brackets and exemption credits. ---
// Joint, both 66, $40,000 pension, $40,000 Social Security (exempt), $30,000 conversion.
// Standard deduction $11,412; credits $153 x 2 + $153 x 2 at 65 = $612.
// Without: 40,000 - 11,412 = 28,588 → 1% x 22,158 + 2% x 6,430 = 350.18, under the credits → $0.
// With: 58,588 → 221.58 + 2% x 30,370 + 4% x 6,060 = 1,071.38 - 612 = 459.38.
// (The flat rate charged 9.3% x 30,000 = 2,790.)
check('CA joint 66, pension 40k + SS 40k, $30k conversion: $459.38',
  cc('CA', 30000, { ...couple(66), pensionIncome: 40000, ss: 40000 }), 459.38);

// --- Utah: taxes Social Security; its credits phase out with income. ---
// Same couple. Taxable Social Security (Pub 915, joint $32,000/$44,000): provisional income
// 40,000 + 20,000 = 60,000 → 0.85 x 16,000 + 6,000 = 19,600; with the conversion 90,000 → capped
// at 0.85 x 40,000 = 34,000. Federal AGI 59,600 → 104,000.
// Tax 4.45% of AGI: 2,652.20 → 4,628.00.
// Taxpayer credit 6% x (31,500 + 2 x 1,600) = 2,082, less 1.3% of AGI over 36,426:
//   1,780.738 → 1,203.538.
// Social Security credit 4.45% of the taxable benefit, less 2.5% of AGI over 90,000:
//   872.20 → 1,513.00 - 350 = 1,163.00.
// Without: 2,652.20 - 1,780.738 - 872.20 < 0 → $0. With: 4,628 - 1,203.538 - 1,163 = 2,261.462.
// (The flat rate charged 4.45% x 30,000 = 1,335.)
check('UT joint 66, pension 40k + SS 40k, $30k conversion: $2,261.46',
  cc('UT', 30000, { ...couple(66), pensionIncome: 40000, ss: 40000 }), 2261.462);

// --- Ohio: a conversion doesn't get the retirement income credit (R.C. 5747.055(A)). ---
// Single, 65, $30,000 wages, $8,000 conversion. Without: 30,000 - 2,400 = 27,600 → 2.75% x 1,550
// = 42.625, under the $50 senior and $20 exemption credits → $0. With: 38,000 - 2,400 = 35,600 →
// 2.75% x 9,550 = 262.625 - 50 (the $20 credit stops at $30,000) = 212.625. As an IRA withdrawal
// in retirement it would also get the $130 retirement income credit ($5,001–$8,000).
check('OH single 65, wages 30k, $8k conversion: $212.63 (no retirement income credit)',
  cc('OH', 8000, { income: 30000 }), 212.625);

// --- Pennsylvania: a conversion is not taxed at any age. ---
check('PA single 45, wages 50k, $50k conversion: $0', cc('PA', 50000, { income: 50000, curAge: 45 }), 0);

// --- Alabama: floored at zero. ---
// Joint, both 66, $90,000 wages, $40,000 Social Security, $30,000 long-term gains, $10,000
// conversion. Alabama excludes the conversion (65+, $6,000 each) but deducts all federal income
// tax, which the conversion raises from 9,953.60 to 12,977.60 (2026 federal: deductions 32,200 +
// 2 x 1,650 + senior 2 x (6,000 - 6% of AGI over 150,000); AGI 154,000 → 164,000; gains stacked
// at 0%/15% above $98,900). Alabama taxable income falls 3,024, its tax $151.20; the tool counts
// no state saving, so $0.
check('AL joint 66, conversion inside the exclusion: $0 (a $151.20 saving, not counted)',
  cc('AL', 10000, { ...couple(66), income: 90000, ss: 40000, ltcg: 30000 }), 0);
// Past the exclusion the conversion is taxed, net of the extra federal tax: single 66, $40,000
// wages, $20,000 conversion, $14,000 of it past the $6,000 exclusion. Federal tax (deductions
// 16,100 + 2,050 + 6,000 senior): 1,654 → 4,054. Alabama: standard deduction at its $2,500 floor,
// $1,500 exemption, all federal tax off: 40,000 - 2,500 - 1,500 - 1,654 = 34,346 → 54,000 -
// 2,500 - 1,500 - 4,054 = 45,946, both well into the 5% band (single: 2% to $500, 4% to $3,000):
// 5% x 11,600 = 580.
check('AL single 66, wages 40k, $20k conversion: $580 (past the exclusion, less the federal tax)',
  cc('AL', 20000, { curAge: 66, income: 40000 }), 580);

// --- Retirement-side state rate (retirementStateRate): marginal tax on $1,000 more IRA withdrawal
// at the retirement income, at retirement age. ---
const rr = (code, o) => retirementStateRate(code, o.status || 'single', '', o.curAge, o.retAge, o.spouseAge ?? null,
  { ss: o.ss || 0, pension: o.pension || 0, other: o.other || 0, withdrawals: o.withdrawals || 0 });
// Michigan, 67: $20,000 pension + $25,000 withdrawals is under the $67,610 cap → 0.
check('MI retirement rate under the cap: 0', rr('MI', { curAge: 60, retAge: 67, ss: 30000, pension: 20000, withdrawals: 25000 }), 0, 0);
// Michigan, 67: $60,000 pension + $30,000 withdrawals: 22,390 over the cap, past the $5,900
// exemption → 4.25%.
check('MI retirement rate over the cap: 4.25%', rr('MI', { curAge: 67, retAge: 67, pension: 60000, withdrawals: 30000 }), 0.0425, 0);
// Michigan, retiring at 55: an IRA withdrawal counts as retirement income only from 59 1/2
// (MCL 206.30(8)(a)(ii)), so $30,000 of withdrawals is taxed past the exemption → 4.25%.
check('MI retirement rate retiring at 55 (before 59 1/2): 4.25%', rr('MI', { curAge: 45, retAge: 55, withdrawals: 30000 }), 0.0425, 0);
// Illinois exempts retirement income → 0.
check('IL retirement rate: 0', rr('IL', { curAge: 60, retAge: 67, withdrawals: 100000 }), 0, 0);
// Mississippi: taxed before 59 1/2 (8,300 off, 0% to $10,000, 4% above), exempt after.
check('MS retirement rate retiring at 58: 4%', rr('MS', { curAge: 50, retAge: 58, withdrawals: 40000 }), 0.04, 0);
check('MS retirement rate retiring at 60: 0', rr('MS', { curAge: 50, retAge: 60, withdrawals: 40000 }), 0, 0);
// Iowa: taxed before 55 (3.8% past the $15,750 deduction), exempt from 55.
check('IA retirement rate retiring at 54: 3.8%', rr('IA', { curAge: 45, retAge: 54, withdrawals: 40000 }), 0.038, 0);
check('IA retirement rate retiring at 55: 0', rr('IA', { curAge: 45, retAge: 55, withdrawals: 40000 }), 0, 0);
// California joint 67/67: $20,000 pension + $50,000 withdrawals - 11,412 = 58,588, in the 4%
// band (to $82,904) → 4%.
check('CA joint retirement rate: 4%', rr('CA', { status: 'mfj', curAge: 67, retAge: 67, spouseAge: 67, ss: 40000, pension: 20000, withdrawals: 50000 }), 0.04, 0);
// New York single 67: $15,000 of withdrawals is inside the $20,000 exclusion → 0; at $30,000,
// $10,000 counts, 2,000 past the $8,000 deduction, in the 3.9% band → 3.9%.
check('NY retirement rate inside the exclusion: 0', rr('NY', { curAge: 67, retAge: 67, ss: 30000, withdrawals: 15000 }), 0, 0);
check('NY retirement rate past the exclusion: 3.9%', rr('NY', { curAge: 67, retAge: 67, ss: 30000, withdrawals: 30000 }), 0.039, 0);
// Already retired: the rate is figured at today's age, not a past retirement age (Michigan at
// 70 with retirement age 58 → 70, so the withdrawals count under the cap → 0).
check('MI retirement rate, already retired (70, retired at 58): 0', rr('MI', { curAge: 70, retAge: 58, withdrawals: 30000 }), 0, 0);
check('TX retirement rate: 0', rr('TX', { curAge: 60, retAge: 67, withdrawals: 80000 }), 0, 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
