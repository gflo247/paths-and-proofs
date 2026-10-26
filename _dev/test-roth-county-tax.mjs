#!/usr/bin/env node
// Maryland's and Indiana's mandatory county income tax in the Roth tool's conversion cost.
// Since 2026-10-25 computeConversionCost() takes state and local tax from the Relocation engine
// (computeStateAndLocalTax), which applies the county rate in states.json localTax.county to the
// state's taxable income, for every resident, whatever the NY/OR locality selector says. The
// rates (3.20% Maryland median and mode, 1.97% Indiana median; sources in states.json) are
// unchanged; until 2026-10-25 the Roth tool added them to its flat state rate on the whole
// conversion, without the deductions and exemptions.
//
// Expected values are hand-computed from each state's 2026 rules in states.json (sources in
// SOURCES.md): Maryland 2% / 3% / 4.75% to $100,000 single ($150,000 joint), standard deduction
// $3,350 ($6,700 joint), $3,200 exemption each (full at these incomes), +$1,000 at 65, and its
// pension exclusion doesn't cover IRAs (so none of a conversion); Indiana 2.95% flat after
// $1,000 per person, +$1,000 at 65.

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
const { computeConversionCost, ST, STRULES } = new Function(scriptSrc + '\nreturn {computeConversionCost, ST, STRULES};')();

let pass = 0, fail = 0;
function check(label, actual, expected, tolerance = 0.01) {
  if (Math.abs(actual - expected) <= tolerance) pass++;
  else { fail++; console.log(`FAIL  ${label}  (got=${actual}, expected=${expected})`); }
}

check('MD county rate is 3.20%', STRULES.MD.localTax.county.rate, 0.032, 0);
check('IN county rate is 1.97%', STRULES.IN.localTax.county.rate, 0.0197, 0);

const ctxFor = (stateCode, o) => ({ income: 0, pensionIncome: 0, nii: 0, ltcg: 0, ss: 0, nSr: 0, status: 'single',
  curAge: 67, spouseAge: null, isCouple: false, taxableFrac: 1, localTax: '', stD: ST[stateCode], stateCode, ...o });

// --- Maryland ---
// Single, 67, $50,000 conversion, no other income. Without: $0.
// With: 50,000 - (3,350 + 3,200 + 1,000) = 42,450 taxable.
//   State: 2% x 1,000 + 3% x 1,000 + 4.75% x 40,450 = 20 + 30 + 1,921.375 = 1,971.375
//   County: 3.2% x 42,450 = 1,358.40.  Total 3,329.775. (Was 50,000 x 7.95% = 3,975.)
check('MD single 67, $50k conversion, no other income: $3,329.78',
  computeConversionCost(50000, ctxFor('MD', {})).cvtTxSt, 3329.775);
// Joint, both 55, $20,000 wages, $15,000 conversion. The wages already use the
// 6,700 + 2 x 3,200 = 13,100 off and the 2% and 3% bands (taxable 6,900), so the whole conversion
// is in the 4.75% band: 15,000 x (4.75% + 3.2%) = 1,192.50.
check('MD joint 55/55, wages 20k, $15k conversion: $1,192.50',
  computeConversionCost(15000, ctxFor('MD', { income: 20000, status: 'mfj', curAge: 55, spouseAge: 55, isCouple: true })).cvtTxSt, 1192.5);
// A pension doesn't shelter the conversion (Maryland's exclusion leaves out IRAs): single 67 with
// a $30,000 pension (all under the $39,500 cap) plus $20,000 converted. Without: the pension is
// excluded → $0. With: 20,000 - 7,550 = 12,450 → 20 + 30 + 4.75% x 10,450 = 546.375 state +
// 3.2% x 12,450 = 398.40 county = 944.775.
check('MD single 67, $30k pension + $20k conversion: $944.78 (exclusion skips IRA money)',
  computeConversionCost(20000, ctxFor('MD', { pensionIncome: 30000 })).cvtTxSt, 944.775);

// --- Indiana ---
// Single, 67, $50,000 conversion: 50,000 - (1,000 + 1,000 at 65) = 48,000 taxable.
//   State 2.95% x 48,000 = 1,416; county 1.97% x 48,000 = 945.60; total 2,361.60.
//   (Was 50,000 x 4.92% = 2,460.)
check('IN single 67, $50k conversion: $2,361.60',
  computeConversionCost(50000, ctxFor('IN', {})).cvtTxSt, 2361.6);
// Joint, both 55, $20,000 wages, $15,000 conversion: the wages use the $2,000 of exemptions, so
// 15,000 x (2.95% + 1.97%) = 738.
check('IN joint 55/55, wages 20k, $15k conversion: $738',
  computeConversionCost(15000, ctxFor('IN', { income: 20000, status: 'mfj', curAge: 55, spouseAge: 55, isCouple: true })).cvtTxSt, 738);

// Unconditional: the county tax ignores the NY/OR locality selector -- a stray value that should
// never reach an MD or IN filer must not change anything if it does.
for (const code of ['MD', 'IN']) {
  const a = computeConversionCost(50000, ctxFor(code, {})).cvtTxSt;
  const b = computeConversionCost(50000, ctxFor(code, { localTax: 'nyc' })).cvtTxSt;
  const c = computeConversionCost(50000, ctxFor(code, { localTax: 'multnomah' })).cvtTxSt;
  check(`${code}: a stray locality value changes nothing (nyc)`, b, a, 1e-9);
  check(`${code}: a stray locality value changes nothing (multnomah)`, c, a, 1e-9);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
