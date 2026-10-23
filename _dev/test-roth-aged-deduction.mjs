#!/usr/bin/env node
// The federal deductions at 65 or older in roth-conversion/index.html.
//
// 1. The additional standard deduction (IRC 63(f)). For 2026 (Rev. Proc. 2025-32): $2,050 for a
//    single or head-of-household filer 65+, and $1,650 for each spouse 65+ on a married return
//    (joint or separate). It is part of the standard deduction on Form 1040 line 12e and sits on
//    top of the separate $6,000 senior deduction (seniorDed). Before 2026-10-22 the tool used the
//    base STDD alone, so a 65+ filer's federal taxable income ran $1,650 to $3,300 high.
// 2. The senior deduction's phase-out (IRC 151(d)(5)(C); Schedule 1-A lines 31-37): 6% of MAGI
//    over $150,000 comes off EACH spouse's $6,000. Before 2026-10-22 it came off the couple's
//    $12,000 once, overstating a couple's deduction by up to $6,000 between $150,000 and $350,000.
// Every expected value below is worked by hand from the 2026 figures, not read back from the code.
//
// Run: node _dev/test-roth-aged-deduction.mjs

import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolveRetirementIncome, federalTaxableSS } from '../core/retirement-rules.js';

// Same harness as test-roth-scenarios.mjs.
const vc = new VirtualConsole();
const dom = new JSDOM(`<!doctype html><body>
  <input id="retSS"><input id="retPen"><input id="retOther">
  <input id="niiIncome"><input id="ltcgIncome">
</body>`, { virtualConsole: vc });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.matchMedia = () => ({ matches: true });
globalThis.window.resolveRetirementIncome = resolveRetirementIncome;
globalThis.window.calcTaxableSS = federalTaxableSS;
globalThis.resolveRetirementIncome = resolveRetirementIncome;
globalThis.calcTaxableSS = federalTaxableSS;

const html = readFileSync(new URL('../roth-conversion/index.html', import.meta.url), 'utf8');
const markerIdx = html.indexOf('function computeConversionCost');
if (markerIdx === -1) throw new Error('computeConversionCost not found in index.html');
const scriptStart = html.lastIndexOf('<script>', markerIdx) + '<script>'.length;
const scriptEnd = html.indexOf('</script>', markerIdx);
const { computeConversionCost } = new Function(html.slice(scriptStart, scriptEnd) + '\nreturn {computeConversionCost};')();

const NO_STATE = { n: '', cr: 0, ex: false };
const ctx = ({ wages, status = 'single', nSr = 0, curAge = 66, spouseAge = null }) => ({
  income: wages, pensionIncome: 0, nii: 0, ltcg: 0, ss: 0, status, nSr, stD: NO_STATE, stateCode: '',
  curAge, spouseAge, isCouple: status === 'mfj', taxableFrac: 1, localTax: '',
});

let pass = 0, fail = 0;
function near(label, actual, expected, tol = 0.5) {
  const ok = Math.abs(actual - expected) <= tol;
  if (ok) { pass++; console.log(`ok    ${label}`); }
  else { fail++; console.log(`FAIL  ${label}  (got ${actual}, expected ${expected})`); }
}

// Taxable income before the conversion (tiBase = AGI - standard deduction - senior deduction).
// Single 66, $50,000: 50,000 - 16,100 - 2,050 - 6,000 (AGI under $75,000: full) = 25,850.
near('single 66, $50,000: taxable income $25,850 (was $27,900)',
  computeConversionCost(0, ctx({ wages: 50000, nSr: 1 })).tiBase, 25850);
// Joint, both 66, $100,000: 100,000 - 32,200 - 2 x 1,650 - 12,000 = 52,500.
near('joint, both 66, $100,000: taxable income $52,500 (was $55,800)',
  computeConversionCost(0, ctx({ wages: 100000, status: 'mfj', nSr: 2, spouseAge: 66 })).tiBase, 52500);
// Joint, one spouse 65+: 100,000 - 32,200 - 1,650 - 6,000 = 60,150.
near('joint, one 65+, $100,000: taxable income $60,150 (was $61,800)',
  computeConversionCost(0, ctx({ wages: 100000, status: 'mfj', nSr: 1, spouseAge: 60 })).tiBase, 60150);
// Married filing separately, 66: no senior deduction, but the $1,650 still applies:
// 50,000 - 16,100 - 1,650 = 32,250.
near('married filing separately, 66, $50,000: taxable income $32,250 (was $33,900)',
  computeConversionCost(0, ctx({ wages: 50000, status: 'mfs', nSr: 1 })).tiBase, 32250);
// Head of household, 66: 50,000 - 24,150 - 2,050 - 6,000 = 17,800.
near('head of household, 66, $50,000: taxable income $17,800 (was $19,850)',
  computeConversionCost(0, ctx({ wages: 50000, status: 'hoh', nSr: 1 })).tiBase, 17800);
// Under 65: unchanged. 50,000 - 16,100 = 33,900.
near('single, under 65: taxable income $33,900 (unchanged)',
  computeConversionCost(0, ctx({ wages: 50000, nSr: 0, curAge: 60 })).tiBase, 33900);

// The federal tax on a conversion that crosses the 12% / 22% line at $50,400 (single):
// $64,000 of wages, converting $10,000, 66. Senior deduction is the full $6,000 both before
// (AGI $64,000) and after ($74,000). Before: 64,000 - 18,150 - 6,000 = 39,850; after: 49,850 —
// all of it at 12%, so the conversion's federal tax is 12% x 10,000 = $1,200.
// (Without the $2,050: 41,900 -> 51,900, so $1,500 of it lands at 22%: 1,020 + 330 = $1,350.)
near('single 66, $64,000 + $10,000 conversion: federal tax on it $1,200 (was $1,350)',
  computeConversionCost(10000, ctx({ wages: 64000, nSr: 1 })).cvtTxFed, 1200);

// The senior deduction for a couple both 65+ in its phase-out range.
// $200,000: 6% x 50,000 = 3,000 off each $6,000 -> 2 x 3,000 = 6,000 (was 12,000 - 3,000 = 9,000).
const mfj = (wages, cvt = 0) => computeConversionCost(cvt, ctx({ wages, status: 'mfj', nSr: 2, spouseAge: 66 }));
near('joint, both 66, $200,000: senior deduction $6,000 (was $9,000)', mfj(200000).srD, 6000);
// 200,000 - 32,200 - 2 x 1,650 - 6,000 = 158,500.
near('joint, both 66, $200,000: taxable income $158,500 (was $158,800)', mfj(200000).tiBase, 158500);
// $250,000: 6% x 100,000 = 6,000 -> nothing left for either spouse (was 6,000).
near('joint, both 66, $250,000: senior deduction gone (was $6,000)', mfj(250000).srD, 0);
// Converting $20,000 on $180,000: before, 1,800 off each -> 8,400, taxable 180,000 - 35,500 -
// 8,400 = 136,100; after ($200,000), 6,000 -> taxable 158,500. 22,400 more taxable, all at 22%:
// 4,928. (Was 21,200 more at 22% = 4,664: the deduction lost half as fast, and no 63(f) amount.)
near('joint, both 66, $180,000 + $20,000 conversion: federal tax on it $4,928 (was $4,664)', mfj(180000, 20000).cvtTxFed, 4928);
// A single filer can't get two: the "both spouses" answer counts once, like the 63(f) amount.
// 50,000 - 16,100 - 2,050 - 6,000 = 25,850 (was 50,000 - 16,100 - 12,000 = 21,900).
near('single 66 answering "both spouses": one senior deduction, taxable income $25,850 (was $21,900)',
  computeConversionCost(0, ctx({ wages: 50000, nSr: 2 })).tiBase, 25850);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
