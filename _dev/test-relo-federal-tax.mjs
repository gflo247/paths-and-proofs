#!/usr/bin/env node
// The federal income tax estimate in relocation/relo-engine.mjs and the three state subtractions
// that use it (taxRules.standardDeduction.federalTaxDeduction): AL subtracts all of it (Form 40
// line 12, worksheet p.31, counting the 3.8% net investment income tax), MO a share by Missouri
// AGI up to $5,000 / $10,000 (MO-1040 lines 9-13), OR up to $8,750 for 2026, less at higher
// federal AGI (ORS 316.695(3); OR-40 instructions Table 4; OR-ESTIMATE 2026).
//
// Part 1 holds the engine's federal figures to the Roth tool's, constant by constant and by
// result, so the two can't drift apart. Parts 2 and 3: every expected value is worked by hand
// from the 2026 federal figures (IRS Rev. Proc. 2025-32) and the states' own forms.
//
// Run: node _dev/test-relo-federal-tax.mjs

import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';
import { computeStateIncomeTax, FEDERAL_2026 } from '../relocation/relo-engine.mjs';
import { resolveRetirementIncome, federalTaxableSS } from '../core/retirement-rules.js';

const states = JSON.parse(readFileSync(new URL('../roth-conversion/states.json', import.meta.url), 'utf8'));
const tax = (code, status, income) => computeStateIncomeTax(states[code].taxRules, status, income);

let pass = 0, fail = 0;
function check(label, actual, expected, tolerance = 0.01) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) { pass++; console.log(`ok    ${label}`); }
  else { fail++; console.log(`FAIL  ${label}  (got ${actual}, expected ${expected} ±${tolerance})`); }
}
function same(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log(`ok    ${label}`); }
  else { fail++; console.log(`FAIL  ${label}\n        engine: ${JSON.stringify(actual)}\n        roth:   ${JSON.stringify(expected)}`); }
}

// A state with no tax of its own and a federal subtraction with no share or cap: its
// breakdown.federalTax is the engine's federal estimate for any income vector.
const ZERO = [{ rate: 0, upTo: null }];
const PROBE = {
  bracketsByStatus: { single: ZERO, mfj: ZERO, mfs: ZERO, hoh: ZERO },
  socialSecurity: { taxed: false },
  retirementIncome: { treatment: 'taxed', ageGate: null, exclusion: null },
  pensionIncome: { sameAs: 'retirementIncome' },
  capitalGains: { treatment: 'ordinary' },
  standardDeduction: { federalTaxDeduction: {} },
};
const federal = (status, income) => computeStateIncomeTax(PROBE, status, income).breakdown.federalTax;

// ============================================================================
// PART 1 — THE SAME FEDERAL FIGURES AS THE ROTH TOOL
// ============================================================================
{
  const vc = new VirtualConsole();
  const dom = new JSDOM('<!doctype html><body></body>', { virtualConsole: vc });
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
  const src = html.slice(html.lastIndexOf('<script>', markerIdx) + '<script>'.length, html.indexOf('</script>', markerIdx));
  const roth = new Function(src + '\nreturn {BRAX, LTCGX, STDD, AGED_ADD, fedStdDed, seniorDed, calcTax, calcLTCGTax};')();

  const ladder = (rows) => rows.map((b) => [b.r, b.m === Infinity ? null : b.m]);
  const mine = (rows) => rows.map((b) => [b.rate, b.upTo]);
  for (const s of ['single', 'mfj', 'mfs', 'hoh']) {
    same(`${s}: brackets match the Roth tool's BRAX`, mine(FEDERAL_2026.brackets[s]), ladder(roth.BRAX[s]));
    same(`${s}: gains brackets match LTCGX`, mine(FEDERAL_2026.gains[s]), ladder(roth.LTCGX[s]));
    same(`${s}: standard deduction matches STDD`, FEDERAL_2026.standardDeduction[s], roth.STDD[s]);
    const married = s === 'mfj' || s === 'mfs';
    same(`${s}: amount at 65 matches AGED_ADD`, married ? FEDERAL_2026.age65AddOn.married : FEDERAL_2026.age65AddOn.unmarried, roth.AGED_ADD[s]);
  }

  // The whole computation, against the Roth tool's own functions, over a grid.
  let n = 0, worst = 0, worstCase = null;
  for (const status of ['single', 'mfj', 'mfs', 'hoh'])
    for (const ss of [0, 24000, 48000]) for (const iraWithdrawal of [0, 30000, 90000, 250000])
      for (const capGains of [0, 15000, 120000]) for (const wages of [0, 60000])
        for (const [age, spouseAge] of [[60, 60], [66, 60], [66, 70], [72, 72]]) {
          const other = iraWithdrawal + capGains + wages;
          const agi = other + federalTaxableSS(ss, other, status);
          const nSr = (age >= 65 ? 1 : 0) + (status === 'mfj' && spouseAge >= 65 ? 1 : 0);
          const std = roth.fedStdDed(status, nSr);
          const sr = roth.seniorDed(agi, status, nSr);
          const ti = Math.max(0, agi - capGains - std - sr);
          const total = Math.max(0, agi - std - sr);
          const expected = roth.calcTax(ti, status) + roth.calcLTCGTax(ti, total - ti, status);
          const got = federal(status, { ss, iraWithdrawal, capGains, wages, age, spouseAge });
          n++;
          if (Math.abs(got - expected) > worst) { worst = Math.abs(got - expected); worstCase = { status, ss, iraWithdrawal, capGains, wages, age, spouseAge, got, expected }; }
        }
  check(`federal tax equals the Roth tool's on ${n} cases (worst gap ${worst.toFixed(6)}${worstCase ? ' at ' + JSON.stringify(worstCase) : ''})`, worst, 0, 1e-6);
}

// ============================================================================
// PART 2 — THE ESTIMATE, BY HAND (2026)
// ============================================================================
// Joint, both 68: $30,000 Social Security, $40,000 IRA, $20,000 pension, $10,000 gains (the
// Relocation page's California preset). Pub 915: provisional 70,000 + 15,000 = 85,000 >
// 44,000 -> min(25,500, 0.85 x 41,000 + 6,000) = 25,500 taxable; AGI 95,500. Deductions:
// 32,200 + 2 x 1,650 + 2 x 6,000 = 47,500. Ordinary 95,500 - 10,000 - 47,500 = 38,000:
// 10% x 24,800 + 12% x 13,200 = 4,064; the gains fill 38,000-48,000, all at 0%.
check('joint, both 68, preset income: $4,064', federal('mfj', { ss: 30000, iraWithdrawal: 40000, pension: 20000, capGains: 10000, age: 68 }), 4064);
// Single, 60, $120,000 wages: 120,000 - 16,100 = 103,900 -> 1,240 + 4,560 + 22% x 53,500.
check('single, 60, $120,000 wages: $17,570', federal('single', { wages: 120000, age: 60 }), 17570);
// Single, 70, $60,000 IRA + $100,000 gains: AGI 160,000; senior deduction 6,000 - 6% x 85,000 =
// 900; deductions 16,100 + 2,050 + 900 = 19,050. Ordinary 40,950: 1,240 + 12% x 28,550 = 4,666.
// Gains 40,950-140,950: 0% to 49,450, then 15% x 91,500 = 13,725.
check('single, 70, $60,000 IRA + $100,000 gains: $18,391', federal('single', { iraWithdrawal: 60000, capGains: 100000, age: 70 }), 18391);
// Married filing separately, 66: the $1,650 at 65 but no senior deduction: 50,000 - 17,750 =
// 32,250 -> 1,240 + 12% x 19,850.
check('married filing separately, 66, $50,000 wages: $3,622', federal('mfs', { wages: 50000, age: 66 }), 3622);

// ============================================================================
// PART 3 — THE STATE SUBTRACTIONS
// ============================================================================
const PRESET = { ss: 30000, iraWithdrawal: 40000, pension: 20000, capGains: 10000, age: 68 };

// --- Oregon (2026): the lesser of federal tax and $8,750 ($4,375 MFS), the limit cut to 80/60/40/20/0%
// at federal AGI of $125,000/130,000/135,000/140,000/145,000 or more ($250,000-$290,000 joint, HoH).
{
  const r = tax('OR', 'mfj', PRESET);
  check('OR joint, preset: subtracts all $4,064 of federal tax', r.breakdown.federalTaxDeduction, 4064);
  // Oregon income 70,000 (Social Security exempt) - 5,800 - 2 x 1,000 - 4,064 = 58,136:
  // 4.75% x 9,100 + 6.75% x 13,700 + 8.75% x 35,336 = 4,448.90, less 2 x $260 = 3,928.90.
  check('OR joint, preset: tax $3,929 (was $4,285)', r.tax, 3929, 0);
  // Single, 60, $132,000: federal 1,240 + 4,560 + 12,166 + 24% x 10,200 = 20,414; limit 60% x
  // 8,750 = 5,250. Oregon: 132,000 - 2,900 - 5,250 = 123,850 -> 216.125 + 462.375 + 8.75% x
  // 112,450 = 10,517.875; no exemption credit over $100,000.
  const s = tax('OR', 'single', { wages: 132000, age: 60 });
  check('OR single, $132,000: limit 60%, $5,250', s.breakdown.federalTaxDeduction, 5250);
  check('OR single, $132,000: tax $10,518', s.tax, 10518, 0);
  check('OR single, $124,999: full $8,750', tax('OR', 'single', { wages: 124999, age: 60 }).breakdown.federalTaxDeduction, 8750);
  check('OR single, $125,000: "at least $125,000" -> 80%, $7,000', tax('OR', 'single', { wages: 125000, age: 60 }).breakdown.federalTaxDeduction, 7000);
  check('OR single, $145,000: none', tax('OR', 'single', { wages: 145000, age: 60 }).breakdown.federalTaxDeduction, 0);
  // MFS: federal 50,000... 60,000 - 16,100 = 43,900 -> 1,240 + 3,780 = 5,020; limit $4,375.
  check('OR married filing separately, $60,000: limit $4,375', tax('OR', 'mfs', { wages: 60000, age: 60 }).breakdown.federalTaxDeduction, 4375);
  check('OR head of household, $255,000: joint bands, 80% -> $7,000', tax('OR', 'hoh', { wages: 255000, age: 60 }).breakdown.federalTaxDeduction, 7000);
  check('OR leaves the net investment income tax out (single, $150,000 wages + $100,000 gains: $39,734, no limit room)',
    tax('OR', 'single', { wages: 150000, capGains: 100000, age: 60 }).breakdown.federalTax, 39734);
}

// --- Missouri (2025 form): federal tax x 35/25/15/5/0% by Missouri AGI (to $25,000 / $50,000 /
// $100,000 / $125,000 / over), at most $5,000 ($10,000 joint).
{
  const r = tax('MO', 'mfj', PRESET);
  // Missouri AGI 60,000 (gains and Social Security exempt): 15% x 4,064 = 609.60. Taxable
  // 60,000 - 31,500 - 2 x 1,600 - 609.60 = 24,690.40: 256.035 to $9,191, + 4.7% x 15,499.40.
  check('MO joint, preset: 15% of $4,064 = $609.60', r.breakdown.federalTaxDeduction, 609.6);
  check('MO joint, preset: tax $985 (was $1,013)', r.tax, 985, 0);
  // Single, 60: $25,000 wages -> federal 890, 35% = 311.50; $25,001 -> 890.12, 25% = 222.53.
  check('MO single, Missouri AGI $25,000: 35%, $311.50', tax('MO', 'single', { wages: 25000, age: 60 }).breakdown.federalTaxDeduction, 311.5);
  check('MO single, Missouri AGI $25,001: 25%, $222.53', tax('MO', 'single', { wages: 25001, age: 60 }).breakdown.federalTaxDeduction, 222.53);
  // Single, $20,000 wages + $200,000 gains (Missouri exempts the gains): federal 390 + 15% x
  // 154,450 = 23,557.50; 35% = 8,245 -> capped at $5,000.
  check('MO single, low Missouri AGI, big federal tax: capped at $5,000',
    tax('MO', 'single', { wages: 20000, capGains: 200000, age: 60 }).breakdown.federalTaxDeduction, 5000);
  check('MO single, Missouri AGI over $125,000: none', tax('MO', 'single', { wages: 130000, age: 60 }).breakdown.federalTaxDeduction, 0);
}

// --- Alabama (2025 form): all of the federal tax, including the net investment income tax.
{
  check('AL joint, preset: all $4,064', tax('AL', 'mfj', PRESET).breakdown.federalTaxDeduction, 4064);
  // Single, 60, $150,000 wages + $100,000 gains: income tax 24,734 + 15% x 100,000 = 39,734;
  // NIIT 3.8% x min(100,000, 250,000 - 200,000) = 1,900.
  check('AL single, $150,000 wages + $100,000 gains: $39,734 + $1,900 NIIT = $41,634',
    tax('AL', 'single', { wages: 150000, capGains: 100000, age: 60 }).breakdown.federalTaxDeduction, 41634);
}

// --- No other state subtracts federal tax.
{
  const others = Object.keys(states).filter((k) => k !== '_schema' && !['AL', 'MO', 'OR'].includes(k)
    && states[k].taxRules?.standardDeduction?.federalTaxDeduction);
  check(`only AL, MO and OR carry a federal tax subtraction (others: ${others.join(', ') || 'none'})`, others.length, 0, 0);
  check('a state without one reports no federal tax', tax('CA', 'mfj', PRESET).breakdown.federalTax, 0, 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
