#!/usr/bin/env node
// New York City's and Yonkers' local income tax in the Roth tool's conversion cost. Unlike
// Maryland's and Indiana's mandatory county tax, these apply only when the filer picks one in the
// wizard (nyLocalTax). Since 2026-10-25 computeConversionCost() takes New York's tax and both local
// taxes from the Relocation engine (computeStateAndLocalTax): NYC's graduated tax on the same New
// York taxable income the state uses (so New York's own $20,000-a-person exclusion for those
// 59 1/2+ reaches the city tax too), and Yonkers' surcharge on the New York tax itself.
//
// Hand-derived from the 2026 figures in states.json (sources in SOURCES.md):
//   New York standard deduction $8,000 single, $16,050 joint, $11,200 head of household;
//     brackets single 3.9% to $8,500, 4.4% to $11,700, 5.15% to $13,900, 5.4% to $80,650,
//     5.9% to $215,400; joint 3.9% to $17,150, ... 5.4% from $27,900 to $161,550; head of
//     household 3.9% to $12,800, 4.4% to $17,650; private retirement income (a conversion)
//     excluded up to $20,000 for each spouse 59 1/2 or older.
//   NYC single 3.078% to $12,000, 3.762% to $25,000, 3.819% to $50,000, 3.876% above; joint
//     3.078% to $21,600, 3.762% to $45,000, 3.819% to $90,000.
//   Yonkers 16.75% of the New York tax.

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
const { computeConversionCost, ST } = new Function(scriptSrc + '\nreturn {computeConversionCost, ST};')();

let pass = 0, fail = 0;
function check(label, actual, expected, tolerance = 0.005) {
  if (Math.abs(actual - expected) <= tolerance) pass++;
  else { fail++; console.log(`FAIL  ${label}  (got=${actual}, expected=${expected})`); }
}

const run = (cvt, o) => computeConversionCost(cvt, { income: 0, pensionIncome: 0, nii: 0, ltcg: 0, ss: 0, nSr: 0,
  stD: ST.NY, stateCode: 'NY', status: 'single', curAge: 45, spouseAge: null, isCouple: false, taxableFrac: 1,
  localTax: '', ...o });
const cc = (cvt, o) => run(cvt, o).cvtTxSt;
const joint = (curAge, spouseAge) => ({ status: 'mfj', isCouple: true, curAge, spouseAge });

// --- 1. NYC, single 45, $40,000 wages, $20,000 conversion (no exclusion under 59 1/2). ---
// New York taxable 32,000 → 52,000, all of the change at 5.4%: 1,080.
// NYC on 32,000: 369.36 + 489.06 + 3.819% x 7,000 = 1,125.75; on 52,000: 369.36 + 489.06 +
// 954.75 + 3.876% x 2,000 = 1,890.69; the city's share 764.94.
check('NY single 45, 40k + 20k, no locality: $1,080', cc(20000, { income: 40000 }), 1080);
check('NY single 45, 40k + 20k, NYC: $1,844.94 (city $764.94)', cc(20000, { income: 40000, localTax: 'nyc' }), 1844.94);
check('NYC: stMarginalDisp is the share of the conversion that went to tax', run(20000, { income: 40000, localTax: 'nyc' }).stMarginalDisp, 1844.94 / 20000, 1e-6);

// --- 2. NYC, single 60, $30,000 wages, $15,000 conversion: all of it inside New York's $20,000
// exclusion, so no state and no city tax. ---
check('NY single 60, fully excluded conversion, NYC: $0', cc(15000, { income: 30000, curAge: 60, localTax: 'nyc' }), 0);

// --- 3. NYC, joint, both 62, $60,000 wages, $50,000 conversion: $40,000 excluded (two $20,000
// caps), $10,000 taxed. New York taxable 43,950 → 53,950 at 5.4%: 540. NYC: 3.762% x 1,050 +
// 3.819% x 8,950 = 39.501 + 341.8005 = 381.3015 (only on the $10,000 left).
check('NY joint 62/62, 60k + 50k, no locality: $540', cc(50000, { income: 60000, ...joint(62, 62) }), 540);
check('NY joint 62/62, 60k + 50k, NYC: $921.30', cc(50000, { income: 60000, ...joint(62, 62), localTax: 'nyc' }), 921.3015);

// --- 4. Yonkers: exactly 16.75% of the New York tax. ---
// Single 45, $50,000 + $20,000: New York taxable 42,000 → 62,000 at 5.4%: 1,080; x 1.1675 = 1,260.90.
check('Yonkers single 45, 50k + 20k: $1,260.90', cc(20000, { income: 50000, localTax: 'yonkers' }), 1260.9);
check('Yonkers: the surcharge is exactly 16.75% of the state tax', cc(20000, { income: 50000, localTax: 'yonkers' }), cc(20000, { income: 50000 }) * 1.1675, 1e-6);
// Joint 62/62, the case-3 conversion: 540 x 1.1675 = 630.45 (the exclusion reaches it too).
check('Yonkers joint 62/62, 60k + 50k: $630.45', cc(50000, { income: 60000, ...joint(62, 62), localTax: 'yonkers' }), 630.45);

// --- 5. A non-New York state ignores a stray locality value. ---
{
  const ga = (localTax) => computeConversionCost(20000, { income: 40000, pensionIncome: 0, nii: 0, ltcg: 0, ss: 0, nSr: 0,
    stD: ST.GA, stateCode: 'GA', status: 'single', curAge: 45, spouseAge: null, isCouple: false, taxableFrac: 1, localTax }).cvtTxSt;
  check('GA ignores a stray localTax value', ga('nyc'), ga(''), 1e-9);
}

// --- 6. No locality: the exclusion is each spouse's own. ---
// Joint, 45 and 62, $60,000 + $50,000: only the 62-year-old's $20,000 cap counts, so $30,000 is
// taxed: 43,950 → 73,950 at 5.4% = 1,620.
check('NY joint 45/62, 60k + 50k: $1,620 (one $20,000 cap)', cc(50000, { income: 60000, ...joint(45, 62) }), 1620);
// Head of household 65, $20,000 + $25,000: $20,000 excluded, $5,000 taxed: New York taxable
// 8,800 → 13,800: 3.9% x 8,800 = 343.20 → 3.9% x 12,800 + 4.4% x 1,000 = 543.20: 200.
check('NY head of household 65, 20k + 25k: $200', cc(25000, { income: 20000, status: 'hoh', curAge: 65 }), 200);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
