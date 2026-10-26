#!/usr/bin/env node
// Portland Metro's Supportive Housing Services (SHS) tax and Multnomah County's Preschool For All
// (PFA) tax in the Roth tool's conversion cost. Since 2026-10-25 computeConversionCost() takes
// Oregon's tax and these local taxes from the Relocation engine (computeStateAndLocalTax):
// Oregon's brackets, standard deduction, exemption credit and subtraction for federal income tax,
// then Metro and Multnomah on Oregon taxable income above their thresholds. Metro and Multnomah
// are NOT mutually exclusive: Multnomah County is inside Metro's three-county district, so a
// Multnomah filer owes both, stacked, while a Washington or Clackamas filer owes only Metro's.
//
// Hand-derived from the 2026 figures in states.json (sources in SOURCES.md: OR-ESTIMATE 2026,
// Form MET-40, the Multnomah PFA tables):
//   Oregon brackets  single 4.75% to $4,550, 6.75% to $11,400, 8.75% to $125,000, 9.9% above;
//                    joint and head of household $9,100 / $22,800 / $250,000
//   standard deduction $2,900 single and separate, $5,800 joint, $4,650 head of household
//   exemption credit $260 a filer, none over federal AGI $100,000 single ($200,000 joint, HoH)
//   federal tax subtraction up to $8,750 ($4,375 separate); the limit is 80/60/40/20/0% of
//     that at federal AGI of $125,000/130,000/135,000/140,000/145,000 or more ($250,000 to
//     $290,000 joint, HoH). The federal tax is the engine's 2026 estimate (FEDERAL_2026: standard
//     deduction $16,100 single, $32,200 joint, $24,150 HoH; 10% / 12% / 22% brackets).
//   Metro 1% above $125,000 single and separate, $200,000 joint and HoH (MET-40's grouping)
//   Multnomah 1.5% above the same, 3% above $250,000 / $400,000
// Every case here is age 45 (no 65+ amounts).

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

const cc = (cvt, o) => computeConversionCost(cvt, { income: 0, pensionIncome: 0, nii: 0, ltcg: 0, ss: 0, nSr: 0,
  stD: ST.OR, stateCode: 'OR', status: 'single', curAge: 45, spouseAge: null, isCouple: false, taxableFrac: 1,
  localTax: '', ...o }).cvtTxSt;

// --- 1. Single, $100,000 wages, $50,000 conversion: straddles Metro's $125,000 threshold. ---
// Without: federal tax on $100,000 is over $8,750 (taxable 83,900: 1,240 + 4,560 + 7,370 = 13,170)
//   and federal AGI is under $125,000, so $8,750 comes off: Oregon taxable 100,000 - 8,750 - 2,900
//   = 88,350 → 216.125 + 462.375 + 8.75% x 76,950 = 7,411.625, less the $260 credit (AGI not over
//   $100,000) = 7,151.625. Below Metro's threshold.
// With: federal AGI $150,000 → no federal subtraction, no credit; taxable 147,100 →
//   216.125 + 462.375 + 8.75% x 113,600 + 9.9% x 22,100 = 12,806.40.
// Oregon: 12,806.40 - 7,151.625 = 5,654.775. Metro: 1% x (147,100 - 125,000) = 221.
// Multnomah adds 1.5% x 22,100 = 331.50.
check('OR single 100k + 50k, no locality: $5,654.78', cc(50000, { income: 100000 }), 5654.775);
check('OR single 100k + 50k, Metro: $5,875.78 (+$221)', cc(50000, { income: 100000, localTax: 'metro' }), 5875.775);
check('OR single 100k + 50k, Multnomah: $6,207.28 (Metro $221 + PFA $331.50, stacked)', cc(50000, { income: 100000, localTax: 'multnomah' }), 6207.275);

// --- 2. Single, $50,000 wages, $20,000 conversion: entirely under both thresholds. ---
// Federal tax $3,820 → $6,570 (taxable 33,900 → 53,900). Oregon taxable 50,000 - 3,820 - 2,900 =
// 43,280 → 70,000 - 6,570 - 2,900 = 60,530; tax 3,468.00 - 260 = 3,208.00 → 4,977.375 - 260 =
// 4,717.375: 1,509.375 (the larger federal subtraction offsets part of it). No local tax either way.
for (const localTax of ['', 'metro', 'multnomah']) {
  check(`OR single 50k + 20k, locality '${localTax}': $1,509.38 (under both thresholds)`, cc(20000, { income: 50000, localTax }), 1509.375);
}

// --- 3. Single, $240,000 wages, $20,000 conversion: straddles Multnomah's $250,000 step. ---
// Federal AGI is over $145,000 both ways: no federal subtraction or credit. Oregon taxable 237,100 →
// 257,100, all at 9.9%: 1,980. Metro: 1% x 20,000 = 200. PFA: 1.5% x (250,000 - 237,100) +
// 3% x (257,100 - 250,000) = 193.50 + 213 = 406.50.
check('OR single 240k + 20k, no locality: $1,980', cc(20000, { income: 240000 }), 1980);
check('OR single 240k + 20k, Metro: $2,180', cc(20000, { income: 240000, localTax: 'metro' }), 2180);
check('OR single 240k + 20k, Multnomah: $2,586.50 (the 3% step reached)', cc(20000, { income: 240000, localTax: 'multnomah' }), 2586.5);

// --- 4. Filing-status grouping (Form MET-40): HoH uses the joint $200,000 threshold, separate
// uses the single $125,000 one. $150,000 wages, $60,000 conversion, Metro's share alone. ---
// Single and separate: no federal subtraction (AGI over $145,000); Oregon taxable 147,100 →
//   207,100: Metro 1% x (207,100 - 125,000) - 1% x (147,100 - 125,000) = 821 - 221 = 600.
// HoH: $8,750 subtracted both ways (the HoH limit falls only from $250,000): 150,000 - 8,750 -
//   4,650 = 136,600 → 196,600, under $200,000: Metro 0. Joint: 150,000 - 8,750 - 5,800 = 135,450
//   → 195,450: Metro 0.
const metroShare = (status) => cc(60000, { income: 150000, status, localTax: 'metro', isCouple: status === 'mfj' || status === 'mfs' })
  - cc(60000, { income: 150000, status, localTax: '', isCouple: status === 'mfj' || status === 'mfs' });
check('Metro share, single: $600', metroShare('single'), 600);
check('Metro share, separate: $600 (single threshold)', metroShare('mfs'), 600);
check('Metro share, head of household: $0 (joint threshold)', metroShare('hoh'), 0);
check('Metro share, joint: $0', metroShare('mfj'), 0);
// And the whole single figure: Oregon 9.9% x 60,000 = 5,940, plus Metro 600.
check('OR single 150k + 60k, Metro: $6,540', cc(60000, { income: 150000, localTax: 'metro' }), 6540);

// --- 5. A non-Oregon state ignores a stray locality value. ---
{
  const ga = (localTax) => computeConversionCost(50000, { income: 0, pensionIncome: 0, nii: 0, ltcg: 0, ss: 0, nSr: 0,
    stD: ST.GA, stateCode: 'GA', status: 'single', curAge: 45, spouseAge: null, isCouple: false, taxableFrac: 1, localTax }).cvtTxSt;
  check('GA ignores a stray localTax value', ga('multnomah'), ga(''), 1e-9);
}

// --- 6. No locality, other statuses. ---
// Single $40,000 + $20,000: federal tax 2,620 → 5,020; Oregon taxable 34,480 → 52,080; tax
//   2,698 - 260 = 2,438 → 4,238 - 260 = 3,978: 1,540.
check('OR single 40k + 20k: $1,540', cc(20000, { income: 40000 }), 1540);
// Joint $240,000 + $20,000: the limit is $8,750 at AGI 240,000 and 60% of it, $5,250, at exactly
//   260,000; Oregon taxable 240,000 - 8,750 - 5,800 = 225,450 → 260,000 - 5,250 - 5,800 = 248,950,
//   all at 8.75% (no credit over $200,000): 8.75% x 23,500 = 2,056.25.
check('OR joint 240k + 20k: $2,056.25 (federal-tax limit steps down)', cc(20000, { income: 240000, status: 'mfj', isCouple: true, spouseAge: 45 }), 2056.25);
// HoH $20,000 + $25,000: federal tax 0 → 2,148 (taxable 20,850: 1,770 + 378); Oregon taxable
//   20,000 - 4,650 = 15,350 → 45,000 - 2,148 - 4,650 = 38,202; tax 432.25 + 421.875 - 260 =
//   594.125 → 432.25 + 924.75 + 8.75% x 15,402 - 260 = 2,444.675: 1,850.55.
check('OR head of household 20k + 25k: $1,850.55', cc(25000, { income: 20000, status: 'hoh' }), 1850.55);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
